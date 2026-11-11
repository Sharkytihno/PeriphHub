// Capteurs de PeriphHub : températures, ventilateurs et charge du processeur, de la carte mère, des cartes
// graphiques et des disques, lus par LibreHardwareMonitorLib (MPL-2.0, https://github.com/LibreHardwareMonitor).
// Depuis la 1.5 : commande des ventilateurs (automatique, vitesse fixe ou courbe selon une température).
//
// Windows ne laisse lire les puces de la carte mère et les registres du processeur qu'à un administrateur,
// avec un pilote du noyau (PawnIO, signé). Ce programme tourne donc en service Windows « PeriphHubSensors »
// (compte système), installé une fois pour toutes avec l'accord de l'utilisateur
// (`periphhub.exe --sensors-service install`, src-tauri/src/sensors.rs).
//
//   - Démarrage À LA DEMANDE : PeriphHub le lance en ouvrant la page Températures (le service autorise
//     les utilisateurs du PC à le démarrer, rien d'autre). Il s'arrête de lui-même 3 minutes après la
//     dernière lecture, SAUF si un ventilateur est réglé à la main : il passe alors en démarrage
//     automatique (différé) pour garder la courbe choisie après un redémarrage, et revient en démarrage
//     manuel quand tout repasse en automatique.
//   - Mesures : photo des capteurs (JSON) sur le canal \\.\pipe\PeriphHubSensors, en lecture seule.
//   - Commandes : canal \\.\pipe\PeriphHubSensorsCmd, une ligne JSON par connexion (« fan », « asus_mode »,
//     « reset »). Tout est revérifié ici, quel que soit l'appelant : bornes, courbe croissante, minimum
//     pour les ventilateurs du processeur et des pompes, et 100 % sur toutes les sorties pilotées dès que
//     le processeur ou la carte graphique devient trop chaud (« sécurité »).
//   - Ventilateurs : sorties des puces de la carte mère (SuperIO : ITE, Nuvoton…) et des cartes graphiques
//     que LibreHardwareMonitor sait commander ; portables ASUS (TUF, ROG, Vivobook…) par l'interface ATK
//     de l'ACPI, comme G-Helper (GPL-3.0) : profils Silencieux / Équilibré / Turbo et courbes de 8 points
//     tenues par le firmware. « Automatique » rend la main à la carte mère (BIOS) ou au profil ASUS.
//   - Ni mémoire vive (bus SMBus, déjà utilisé par l'éclairage OpenRGB), ni contrôleurs USB (watercoolings,
//     alimentations : PeriphHub les pilote lui-même), ni réseau : deux logiciels sur la même puce se
//     mélangeraient les échanges.
//
// Compilé par scripts/fetch-sensors.ps1 avec le compilateur C# livré dans Windows (.NET Framework 4.8) :
// pas de SDK à installer, syntaxe C# 5.
//
// `PeriphHubSensors.exe --once` : une lecture, affichée dans la console (essai sans service).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using LibreHardwareMonitor.Hardware;

public static class Program
{
    // Les bibliothèques sont à côté du programme ; une dépendance qui en demande une autre version
    // (BlackSharp.Core 1.0.4 au lieu de 1.0.7…) reçoit celle qui est livrée.
    static Assembly Resolve(object sender, ResolveEventArgs e)
    {
        string p = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, new AssemblyName(e.Name).Name + ".dll");
        return File.Exists(p) ? Assembly.LoadFrom(p) : null;
    }

    public static int Main(string[] args)
    {
        AppDomain.CurrentDomain.AssemblyResolve += Resolve;
        if (args.Length > 0 && args[0] == "--once")
            return Once();
        if (args.Length > 0 && args[0] == "--selftest")
            return Fans.SelfTest();
        ServiceBase.Run(new SensorsService());
        return 0;
    }

    static int Once()
    {
        try
        {
            Hw.Open();
            Hw.Snapshot();
            Thread.Sleep(1000);
            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine(Hw.Snapshot());
            Hw.Close();
            return 0;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine(e);
            return 1;
        }
    }
}

public class SensorsService : ServiceBase
{
    const string PIPE = "PeriphHubSensors";
    const string CMD_PIPE = "PeriphHubSensorsCmd";
    const long IDLE_MS = 180000;
    volatile bool stopping;
    long lastAsk;
    long reapplyAt; // sortie de veille, changement d'alimentation : profil et courbes ASUS renvoyés
    string latest = "{\"v\":1,\"ready\":false}";
    readonly object gate = new object();
    Thread worker, server, commands;

    public SensorsService()
    {
        ServiceName = "PeriphHubSensors";
        CanStop = true;
        CanShutdown = true;
        CanHandlePowerEvent = true;
        AutoLog = false;
    }

    static long Now()
    {
        return DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
    }

    protected override void OnStart(string[] args)
    {
        Interlocked.Exchange(ref lastAsk, Now());
        worker = new Thread(Work) { IsBackground = true, Name = "capteurs" };
        server = new Thread(Serve) { IsBackground = true, Name = "canal" };
        commands = new Thread(Commands) { IsBackground = true, Name = "commandes" };
        worker.Start();
        server.Start();
        commands.Start();
    }

    protected override void OnStop()
    {
        stopping = true;
        if (server != null) server.Join(2000);
        if (commands != null) commands.Join(2000);
        if (worker != null) worker.Join(5000);
        // Les ventilateurs repartent sur la courbe de la carte mère (ou le profil ASUS)
        try { lock (Fans.Sync) Fans.Release(); } catch { }
        try { Hw.Close(); } catch { }
    }

    protected override void OnShutdown()
    {
        OnStop();
    }

    protected override bool OnPowerEvent(PowerBroadcastStatus s)
    {
        if (s == PowerBroadcastStatus.ResumeAutomatic || s == PowerBroadcastStatus.ResumeSuspend
            || s == PowerBroadcastStatus.PowerStatusChange)
            Interlocked.Exchange(ref reapplyAt, Now() + 3000);
        return true;
    }

    void Set(string json)
    {
        lock (gate) latest = json;
    }

    string Get()
    {
        lock (gate) return latest;
    }

    void Work()
    {
        try
        {
            lock (Fans.Sync)
            {
                Fans.Load();
                Hw.Open();
                Atk.Open();
                Atk.Reapply();
                Fans.SyncBoot();
            }
        }
        catch (Exception e)
        {
            Set("{\"v\":1,\"ready\":true,\"error\":" + Hw.Str(e.GetType().Name + ": " + e.Message) + ",\"hw\":[]}");
            return;
        }
        while (!stopping)
        {
            try
            {
                lock (Fans.Sync)
                {
                    long at = Interlocked.Read(ref reapplyAt);
                    if (at != 0 && Now() >= at)
                    {
                        Interlocked.Exchange(ref reapplyAt, 0);
                        Atk.Reapply();
                    }
                    string snap = Hw.Snapshot();
                    Fans.Tick();
                    Set(snap.Substring(0, snap.Length - 1) + ",\"fan\":" + Fans.Json() + "}");
                }
            }
            catch (Exception e) { Set("{\"v\":1,\"ready\":true,\"error\":" + Hw.Str(e.GetType().Name + ": " + e.Message) + ",\"hw\":[]}"); }
            if (!Fans.Active && Now() - Interlocked.Read(ref lastAsk) > IDLE_MS)
            {
                // Plus personne ne lit et aucun ventilateur n'est piloté : le service s'arrête
                // (Stop() depuis un autre fil, OnStop attend celui-ci)
                new Thread(Stop) { IsBackground = true }.Start();
                return;
            }
            for (int i = 0; i < 20 && !stopping; i++) Thread.Sleep(100);
        }
    }

    static PipeSecurity Security(PipeAccessRights users)
    {
        var ps = new PipeSecurity();
        ps.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        ps.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
            users | PipeAccessRights.Synchronize, AccessControlType.Allow));
        ps.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null),
            users | PipeAccessRights.Synchronize, AccessControlType.Allow));
        return ps;
    }

    void Serve()
    {
        var ps = Security(PipeAccessRights.Read);
        while (!stopping)
        {
            try
            {
                using (var p = new NamedPipeServerStream(PIPE, PipeDirection.Out, 1, PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous, 0, 1 << 16, ps))
                {
                    IAsyncResult ar = p.BeginWaitForConnection(null, null);
                    while (!ar.AsyncWaitHandle.WaitOne(300))
                        if (stopping) return;
                    p.EndWaitForConnection(ar);
                    Interlocked.Exchange(ref lastAsk, Now());
                    byte[] b = Encoding.UTF8.GetBytes(Get());
                    p.Write(b, 0, b.Length);
                    p.Flush();
                    try { p.WaitForPipeDrain(); } catch { }
                }
            }
            catch
            {
                // Lecteur parti en cours de route, canal déjà pris… : on recommence
                Thread.Sleep(200);
            }
        }
    }

    // Une commande par connexion : une ligne JSON (64 Ko au plus), une ligne JSON en réponse.
    // Lecture et écriture des données seulement : pas le droit de créer une autre instance du canal.
    void Commands()
    {
        var ps = Security(PipeAccessRights.ReadData | PipeAccessRights.WriteData | PipeAccessRights.ReadAttributes);
        while (!stopping)
        {
            try
            {
                using (var p = new NamedPipeServerStream(CMD_PIPE, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous, 1 << 16, 1 << 16, ps))
                {
                    IAsyncResult ar = p.BeginWaitForConnection(null, null);
                    while (!ar.AsyncWaitHandle.WaitOne(300))
                        if (stopping) return;
                    p.EndWaitForConnection(ar);
                    Interlocked.Exchange(ref lastAsk, Now());
                    var buf = new MemoryStream();
                    var one = new byte[4096];
                    var t0 = Now();
                    while (buf.Length < 65536 && Now() - t0 < 3000)
                    {
                        var r = p.BeginRead(one, 0, one.Length, null, null);
                        if (!r.AsyncWaitHandle.WaitOne(3000)) break;
                        int n = p.EndRead(r);
                        if (n <= 0) break;
                        buf.Write(one, 0, n);
                        if (Array.IndexOf(one, (byte)'\n', 0, n) >= 0) break;
                    }
                    string answer;
                    try
                    {
                        string line = Encoding.UTF8.GetString(buf.ToArray()).Trim();
                        lock (Fans.Sync) answer = Fans.Command(line);
                    }
                    catch (Exception e)
                    {
                        answer = "{\"ok\":false,\"error\":" + Hw.Str(e.Message) + "}";
                    }
                    byte[] b = Encoding.UTF8.GetBytes(answer + "\n");
                    p.Write(b, 0, b.Length);
                    p.Flush();
                    try { p.WaitForPipeDrain(); } catch { }
                }
            }
            catch
            {
                Thread.Sleep(200);
            }
        }
    }
}

public static class Hw
{
    static Computer pc;
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    // Capteurs du dernier relevé, par identifiant (commandes des ventilateurs, sondes des courbes)
    public static readonly Dictionary<string, ISensor> ById = new Dictionary<string, ISensor>();

    public static void Open()
    {
        pc = new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            IsMotherboardEnabled = true,
            IsStorageEnabled = true,
            IsMemoryEnabled = false,
            IsControllerEnabled = false,
            IsPsuEnabled = false,
            IsNetworkEnabled = false,
            IsBatteryEnabled = false,
        };
        pc.Open();
    }

    public static void Close()
    {
        if (pc != null) pc.Close();
        pc = null;
        ById.Clear();
    }

    public static string Str(string s)
    {
        if (s == null) return "null";
        var sb = new StringBuilder("\"");
        foreach (char c in s)
        {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c < 0x20 || c == '\u2028' || c == '\u2029') sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }

    public static string Num(float? v)
    {
        if (!v.HasValue || float.IsNaN(v.Value) || float.IsInfinity(v.Value)) return "null";
        return Math.Round(v.Value, 1).ToString("0.#", Inv);
    }

    static bool Wanted(SensorType t)
    {
        return t == SensorType.Temperature || t == SensorType.Fan || t == SensorType.Control
            || t == SensorType.Load || t == SensorType.Power || t == SensorType.Clock;
    }

    public static string Snapshot()
    {
        var sb = new StringBuilder();
        sb.Append("{\"v\":2,\"ready\":true,\"lib\":\"LibreHardwareMonitor 0.9.6\",\"hw\":[");
        bool first = true;
        ById.Clear();
        if (pc != null)
            foreach (IHardware h in pc.Hardware)
                Add(h, null, sb, ref first);
        Atk.Hardware(sb, ref first);
        return sb.Append("]}").ToString();
    }

    static void Add(IHardware h, string parent, StringBuilder sb, ref bool first)
    {
        try { h.Update(); } catch { }
        if (!first) sb.Append(',');
        first = false;
        sb.Append("{\"id\":").Append(Str(h.Identifier.ToString()))
          .Append(",\"n\":").Append(Str(h.Name))
          .Append(",\"k\":").Append(Str(h.HardwareType.ToString()))
          .Append(",\"p\":").Append(Str(parent))
          .Append(",\"s\":[");
        bool f = true;
        foreach (ISensor s in h.Sensors)
        {
            if (!Wanted(s.SensorType)) continue;
            string id = s.Identifier.ToString();
            ById[id] = s;
            if (!f) sb.Append(',');
            f = false;
            sb.Append("{\"n\":").Append(Str(s.Name))
              .Append(",\"k\":").Append(Str(s.SensorType.ToString()))
              .Append(",\"i\":").Append(s.Index.ToString(Inv))
              .Append(",\"id\":").Append(Str(id))
              .Append(",\"v\":").Append(Num(s.Value))
              .Append(",\"max\":").Append(Num(s.Max));
            // Sortie de ventilateur que LibreHardwareMonitor sait commander
            if (s.SensorType == SensorType.Control && s.Control != null)
                sb.Append(",\"ctl\":{\"m\":").Append(Str(s.Control.ControlMode.ToString()))
                  .Append(",\"min\":").Append(Num(s.Control.MinSoftwareValue))
                  .Append(",\"max\":").Append(Num(s.Control.MaxSoftwareValue)).Append('}');
            sb.Append('}');
        }
        sb.Append("]}");
        foreach (IHardware sub in h.SubHardware)
            Add(sub, h.Identifier.ToString(), sb, ref first);
    }
}

// Réglage d'une sortie. Identifiant : celui de la commande LibreHardwareMonitor (« /lpc/it8689e/0/control/0 »)
// ou « asus/cpu », « asus/gpu », « asus/mid ».
public class FanCfg
{
    public string Id;
    public string Mode = "auto"; // auto | fixed | curve
    public int Pct = 50;
    public string Src;           // sonde de la courbe (identifiant LibreHardwareMonitor) ; ASUS : celle du firmware
    public int[] T = new int[0]; // températures des points (°C), croissantes
    public int[] P = new int[0]; // vitesses des points (%)
}

public static class Fans
{
    public static readonly object Sync = new object();
    static readonly Dictionary<string, FanCfg> cfg = new Dictionary<string, FanCfg>();
    public static int AsusMode = -1; // profil ASUS choisi (0 Équilibré, 1 Turbo, 2 Silencieux), -1 : jamais
    static readonly Dictionary<string, float> sent = new Dictionary<string, float>(); // consignes envoyées (%)
    public static bool Panic;
    static bool boot;
    static string lastError;

    // Sécurité : au-delà, 100 % sur toutes les sorties pilotées, jusqu'à être redescendu sous la reprise
    const float CPU_HOT = 90, CPU_OK = 82, GPU_HOT = 85, GPU_OK = 78, SPOT_HOT = 100, SPOT_OK = 92;
    const int MIN_CPU = 20; // ventilateur du processeur, pompe : jamais en dessous

    static string File
    {
        get
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "PeriphHub-Sensors", "fans.json");
        }
    }

    public static bool Active
    {
        get
        {
            lock (Sync)
            {
                if (AsusMode >= 0) return true;
                foreach (var c in cfg.Values) if (c.Mode != "auto") return true;
                return false;
            }
        }
    }

    // ---------- Réglages gardés (%ProgramData%\PeriphHub-Sensors\fans.json) ----------

    public static void Load()
    {
        try
        {
            if (!System.IO.File.Exists(File)) return;
            var root = new JavaScriptSerializer().DeserializeObject(System.IO.File.ReadAllText(File, Encoding.UTF8)) as Dictionary<string, object>;
            if (root == null) return;
            object m;
            if (root.TryGetValue("asusMode", out m)) AsusMode = Clamp(ToInt(m, -1), -1, 2);
            object list;
            if (root.TryGetValue("fans", out list) && list is object[])
                foreach (object o in (object[])list)
                {
                    string err;
                    FanCfg c = Parse(o as Dictionary<string, object>, out err);
                    if (c != null) cfg[c.Id] = c;
                }
        }
        catch { }
    }

    static void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(File));
            System.IO.File.WriteAllText(File, "{\"asusMode\":" + AsusMode + ",\"fans\":" + CfgJson() + "}", new UTF8Encoding(false));
        }
        catch { }
    }

    static int ToInt(object o, int def)
    {
        try { return o == null ? def : (int)Math.Round(Convert.ToDouble(o, CultureInfo.InvariantCulture)); }
        catch { return def; }
    }

    static int Clamp(int v, int lo, int hi)
    {
        return v < lo ? lo : v > hi ? hi : v;
    }

    static FanCfg Parse(Dictionary<string, object> d, out string err)
    {
        err = null;
        if (d == null) { err = "réglage illisible"; return null; }
        object o;
        var c = new FanCfg();
        c.Id = d.TryGetValue("id", out o) ? o as string : null;
        if (string.IsNullOrEmpty(c.Id) || c.Id.Length > 200) { err = "sortie inconnue"; return null; }
        c.Mode = d.TryGetValue("mode", out o) ? o as string : "auto";
        if (c.Mode != "auto" && c.Mode != "fixed" && c.Mode != "curve") { err = "mode inconnu"; return null; }
        c.Pct = Clamp(d.TryGetValue("pct", out o) ? ToInt(o, 50) : 50, 0, 100);
        c.Src = d.TryGetValue("src", out o) ? o as string : null;
        if (c.Src != null && c.Src.Length > 200) c.Src = null;
        if (c.Mode == "curve")
        {
            object[] ts = d.TryGetValue("t", out o) ? o as object[] : null;
            object[] pts = d.TryGetValue("p", out o) ? o as object[] : null;
            if (ts == null || pts == null || ts.Length != pts.Length || ts.Length < 2 || ts.Length > 8) { err = "courbe : 2 à 8 points"; return null; }
            c.T = new int[ts.Length];
            c.P = new int[ts.Length];
            for (int i = 0; i < ts.Length; i++)
            {
                c.T[i] = Clamp(ToInt(ts[i], 0), 0, 110);
                c.P[i] = Clamp(ToInt(pts[i], 0), 0, 100);
                if (i > 0 && c.T[i] <= c.T[i - 1]) { err = "courbe : températures croissantes attendues"; return null; }
            }
            // Jamais moins vite en chauffant
            for (int i = 1; i < c.P.Length; i++) if (c.P[i] < c.P[i - 1]) c.P[i] = c.P[i - 1];
        }
        return c;
    }

    static string CfgJson()
    {
        var sb = new StringBuilder("[");
        bool first = true;
        foreach (var c in cfg.Values)
        {
            if (!first) sb.Append(',');
            first = false;
            sb.Append("{\"id\":").Append(Hw.Str(c.Id)).Append(",\"mode\":").Append(Hw.Str(c.Mode))
              .Append(",\"pct\":").Append(c.Pct).Append(",\"src\":").Append(Hw.Str(c.Src))
              .Append(",\"t\":[").Append(string.Join(",", c.T)).Append("],\"p\":[").Append(string.Join(",", c.P)).Append("]}");
        }
        return sb.Append(']').ToString();
    }

    // État pour l'interface : réglages, consignes envoyées, sécurité, ASUS
    public static string Json()
    {
        var sb = new StringBuilder("{\"cfg\":").Append(CfgJson()).Append(",\"out\":{");
        bool first = true;
        foreach (var kv in sent)
        {
            if (!first) sb.Append(',');
            first = false;
            sb.Append(Hw.Str(kv.Key)).Append(':').Append(Hw.Num(kv.Value));
        }
        sb.Append("},\"panic\":").Append(Panic ? "true" : "false")
          .Append(",\"boot\":").Append(boot ? "true" : "false")
          .Append(",\"minCpu\":").Append(MIN_CPU)
          .Append(",\"hot\":{\"cpu\":").Append(CPU_HOT.ToString(CultureInfo.InvariantCulture))
          .Append(",\"gpu\":").Append(GPU_HOT.ToString(CultureInfo.InvariantCulture)).Append('}')
          .Append(",\"error\":").Append(Hw.Str(lastError))
          .Append(",\"asus\":").Append(Atk.Json(AsusMode)).Append('}');
        return sb.ToString();
    }

    // ---------- Commandes (canal \\.\pipe\PeriphHubSensorsCmd) ----------

    public static string Command(string line)
    {
        var d = new JavaScriptSerializer().DeserializeObject(line) as Dictionary<string, object>;
        object o;
        string cmd = d != null && d.TryGetValue("cmd", out o) ? o as string : null;
        string err = null;
        if (cmd == "fan")
        {
            FanCfg c = Parse(d, out err);
            if (c != null)
            {
                bool asus = c.Id.StartsWith("asus/");
                if (asus ? !Atk.Has(c.Id) : !IsControl(c.Id)) err = "sortie inconnue sur ce PC";
                else if (asus && c.Mode == "curve" && c.T.Length != 8) err = "courbe ASUS : 8 points";
                else if (asus && !Atk.Curves && c.Mode != "auto") err = "ce portable n’accepte pas de courbe";
                else
                {
                    FanCfg old;
                    bool was = cfg.TryGetValue(c.Id, out old) && old.Mode != "auto";
                    if (c.Mode == "auto") cfg.Remove(c.Id); else cfg[c.Id] = c;
                    if (asus) Atk.Reapply(); // ASUS : profil puis courbes (« automatique » : le profil les remet)
                    else if (c.Mode == "auto" && was) Default(c.Id);
                    else Tick();
                }
            }
        }
        else if (cmd == "asus_mode")
        {
            int m = d.TryGetValue("v", out o) ? ToInt(o, -2) : -2;
            if (!Atk.Ok) err = "pas de profils ASUS sur ce PC";
            else if (m < 0 || m > 2) err = "profil inconnu";
            else
            {
                AsusMode = m;
                if (!Atk.Reapply()) err = "profil refusé par ce PC";
            }
        }
        else if (cmd == "reset")
        {
            Release();
            cfg.Clear();
            AsusMode = -1;
        }
        else err = "commande inconnue";
        if (err == null)
        {
            Save();
            SyncBoot();
        }
        return err == null ? "{\"ok\":true,\"fan\":" + Json() + "}" : "{\"ok\":false,\"error\":" + Hw.Str(err) + "}";
    }

    static bool IsControl(string id)
    {
        ISensor s;
        return Hw.ById.TryGetValue(id, out s) && s.SensorType == SensorType.Control && s.Control != null;
    }

    public static FanCfg Get(string id)
    {
        FanCfg c;
        return cfg.TryGetValue(id, out c) ? c : null;
    }

    // Démarrage avec Windows tant qu'un réglage manuel existe (le service se règle lui-même)
    public static void SyncBoot()
    {
        bool want = Active;
        if (Svc.SetAuto(want)) boot = want;
    }

    // ---------- Pilotage (toutes les 2 s, après le relevé) ----------

    // Vitesse lue sur la courbe (droite entre deux points, plat avant le premier et après le dernier)
    public static float Curve(int[] t, int[] p, float temp)
    {
        if (t.Length == 0) return 100;
        if (temp <= t[0]) return p[0];
        for (int i = 1; i < t.Length; i++)
            if (temp <= t[i]) return p[i - 1] + (p[i] - p[i - 1]) * (temp - t[i - 1]) / (t[i] - t[i - 1]);
        return p[p.Length - 1];
    }

    // Ventilateur du processeur ou pompe : jamais sous MIN_CPU
    public static bool Critical(string name)
    {
        string n = (name ?? "").ToLowerInvariant();
        return n.Contains("cpu") || n.Contains("pump") || n.Contains("aio") || n.Contains("opt");
    }

    static float? Temp(string id)
    {
        ISensor s;
        if (id == null || !Hw.ById.TryGetValue(id, out s) || s.SensorType != SensorType.Temperature || !s.Value.HasValue) return null;
        float v = s.Value.Value;
        return v > 0 && v < 125 ? (float?)v : null;
    }

    static void UpdatePanic()
    {
        float cpu = 0, gpu = 0, spot = 0;
        foreach (ISensor s in Hw.ById.Values)
        {
            if (s.SensorType != SensorType.Temperature || !s.Value.HasValue) continue;
            float v = s.Value.Value;
            if (v <= 0 || v >= 125) continue;
            string n = s.Name ?? "";
            HardwareType k = s.Hardware.HardwareType;
            if (k == HardwareType.Cpu && n.IndexOf("Distance", StringComparison.OrdinalIgnoreCase) < 0) cpu = Math.Max(cpu, v);
            else if (k == HardwareType.GpuNvidia || k == HardwareType.GpuAmd || k == HardwareType.GpuIntel)
            {
                if (n.IndexOf("Hot", StringComparison.OrdinalIgnoreCase) >= 0 || n.IndexOf("Junction", StringComparison.OrdinalIgnoreCase) >= 0) spot = Math.Max(spot, v);
                else if (n.IndexOf("Core", StringComparison.OrdinalIgnoreCase) >= 0) gpu = Math.Max(gpu, v);
            }
        }
        if (cpu >= CPU_HOT || gpu >= GPU_HOT || spot >= SPOT_HOT) Panic = true;
        else if (cpu < CPU_OK && gpu < GPU_OK && spot < SPOT_OK) Panic = false;
    }

    public static void Tick()
    {
        UpdatePanic();
        lastError = null;
        foreach (var c in cfg.Values)
        {
            if (c.Id.StartsWith("asus/") || c.Mode == "auto") continue;
            ISensor s;
            if (!Hw.ById.TryGetValue(c.Id, out s) || s.Control == null) continue;
            IControl ctl = s.Control;
            float want = c.Mode == "fixed" ? c.Pct : Curve(c.T, c.P, Temp(c.Src) ?? 100); // sonde illisible : 100 %
            float min = Critical(s.Name) || Critical(Paired(s)) ? MIN_CPU : 0;
            if (want < min) want = min;
            if (Panic) want = 100;
            float last;
            // Courbe : redescend doucement (3 % toutes les 2 s), monte tout de suite
            if (c.Mode == "curve" && !Panic && sent.TryGetValue(c.Id, out last) && want < last - 3) want = last - 3;
            float lo = ctl.MinSoftwareValue, hi = ctl.MaxSoftwareValue;
            if (hi <= lo) { lo = 0; hi = 100; }
            float v = lo + (hi - lo) * want / 100f;
            try
            {
                ctl.SetSoftware(v);
                sent[c.Id] = want;
            }
            catch (Exception e) { lastError = s.Name + " : " + e.Message; }
        }
    }

    // Nom du ventilateur mesuré qui va avec la commande (même puce, même numéro)
    static string Paired(ISensor ctl)
    {
        foreach (ISensor s in ctl.Hardware.Sensors)
            if (s.SensorType == SensorType.Fan && s.Index == ctl.Index) return s.Name;
        return null;
    }

    static void Default(string id)
    {
        ISensor s;
        sent.Remove(id);
        if (Hw.ById.TryGetValue(id, out s) && s.Control != null)
            try { s.Control.SetDefault(); } catch { }
    }

    // Tout repasse en automatique (arrêt du service, « reset ») ; les réglages gardés ne changent pas
    public static void Release()
    {
        foreach (var id in new List<string>(sent.Keys)) Default(id);
        bool asus = AsusMode >= 0;
        foreach (var c in cfg.Values) if (c.Id.StartsWith("asus/") && c.Mode != "auto") asus = true;
        if (asus && Atk.Ok) Atk.SetMode(AsusMode < 0 ? 0 : AsusMode);
    }

    // Courbe ASUS (8 points) d'un réglage, avec les mêmes garde-fous : croissante, au moins 50 % dès 80 °C,
    // et le dernier point à 80 % au moins
    public static byte[] AsusCurve(FanCfg c, byte[] def)
    {
        var b = new byte[16];
        for (int i = 0; i < 8; i++)
        {
            int t = c.Mode == "curve" ? c.T[i] : (def != null && Atk.Valid(def) ? def[i] : 30 + i * 10);
            int p = c.Mode == "curve" ? c.P[i] : c.Pct;
            if (i > 0 && t <= b[i - 1]) t = b[i - 1] + 1;
            if (i > 0 && p < b[8 + i - 1]) p = b[8 + i - 1];
            if (t >= 80 && p < 50) p = 50;
            if (i == 7 && p < 80) p = 80;
            if (c.Id == "asus/cpu" && p < MIN_CPU) p = MIN_CPU;
            b[i] = (byte)Clamp(t, 0, 120);
            b[8 + i] = (byte)Clamp(p, 0, 100);
        }
        return b;
    }

    // `PeriphHubSensors.exe --selftest` : vérifie les calculs (CI, sans matériel)
    public static int SelfTest()
    {
        int bad = 0;
        Action<bool, string> ok = (cond, msg) => { if (!cond) { Console.Error.WriteLine("ÉCHEC " + msg); bad++; } };
        int[] t = { 40, 60, 80 }, p = { 20, 50, 100 };
        ok(Curve(t, p, 30) == 20, "avant le premier point");
        ok(Curve(t, p, 50) == 35, "entre deux points");
        ok(Curve(t, p, 90) == 100, "après le dernier point");
        string e;
        var d = new JavaScriptSerializer().DeserializeObject("{\"id\":\"x\",\"mode\":\"curve\",\"t\":[30,50,70],\"p\":[60,40,90]}") as Dictionary<string, object>;
        FanCfg c = Parse(d, out e);
        ok(c != null && c.P[1] == 60, "courbe rendue croissante");
        d = new JavaScriptSerializer().DeserializeObject("{\"id\":\"x\",\"mode\":\"curve\",\"t\":[50,40],\"p\":[10,20]}") as Dictionary<string, object>;
        ok(Parse(d, out e) == null, "températures décroissantes refusées");
        d = new JavaScriptSerializer().DeserializeObject("{\"id\":\"x\",\"mode\":\"boost\"}") as Dictionary<string, object>;
        ok(Parse(d, out e) == null, "mode inconnu refusé");
        var f = new FanCfg { Id = "asus/cpu", Mode = "fixed", Pct = 0 };
        byte[] b = AsusCurve(f, null);
        ok(b[8] == MIN_CPU && b[15] >= 80 && b[13] >= 50, "garde-fous ASUS");
        ok(Critical("CPU Fan") && Critical("Pump") && !Critical("System Fan #2"), "ventilateurs critiques");
        Console.WriteLine(bad == 0 ? "selftest ok" : bad + " échec(s)");
        return bad == 0 ? 0 : 1;
    }
}

// Interface ATK de l'ACPI des portables ASUS (\\.\ATKACPI, pilote ASUS livré avec Windows ou MyASUS).
// Méthodes DSTS (lecture) et DEVS (écriture) ; identifiants repris de G-Helper (GPL-3.0,
// https://github.com/seerge/g-helper, app/AsusACPI.cs).
public static class Atk
{
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool DeviceIoControl(IntPtr h, uint code, byte[] inBuf, uint inLen, byte[] outBuf, uint outLen, ref uint ret, IntPtr ov);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);

    const uint IOCTL = 0x0022240C, DSTS = 0x53545344, DEVS = 0x53564544, INIT = 0x54494E49;
    const uint PERF = 0x00120075; // profil : 0 Équilibré, 1 Turbo, 2 Silencieux

    class Fan
    {
        public string Id, Name;
        public uint Speed, CurveDev;
        public byte[] Def; // courbe du profil en cours (lue au démarrage et après chaque changement de profil)
        public int Rpm = -1;
    }

    static IntPtr h = IntPtr.Zero;
    static readonly List<Fan> fans = new List<Fan>();
    public static bool Curves;
    public static bool Ok { get { return h != IntPtr.Zero; } }

    public static bool Has(string id)
    {
        foreach (var f in fans) if (f.Id == id) return true;
        return false;
    }

    public static void Open()
    {
        IntPtr x = CreateFile(@"\\.\ATKACPI", 0xC0000000, 3, IntPtr.Zero, 3, 0x80, IntPtr.Zero);
        if (x == IntPtr.Zero || x == new IntPtr(-1)) return;
        h = x;
        try
        {
            Call(INIT, new byte[8]);
            Add("asus/cpu", "Ventilateur du processeur", 0x00110013, 0x00110024);
            Add("asus/gpu", "Ventilateur de la carte graphique", 0x00110014, 0x00110025);
            Add("asus/mid", "Ventilateur central", 0x00110031, 0x00110032);
        }
        catch { fans.Clear(); }
        if (fans.Count == 0) { CloseHandle(h); h = IntPtr.Zero; }
    }

    static void Add(string id, string name, uint speed, uint curve)
    {
        var f = new Fan { Id = id, Name = name, Speed = speed, CurveDev = curve };
        f.Rpm = Speed100(speed);
        f.Def = ReadCurve(curve, Fans.AsusMode < 0 ? 0 : Fans.AsusMode);
        bool cv = Valid(f.Def);
        if (f.Rpm < 0 && !cv) return;
        if (cv) Curves = true;
        fans.Add(f);
    }

    static byte[] Call(uint method, byte[] args)
    {
        var inBuf = new byte[8 + args.Length];
        BitConverter.GetBytes(method).CopyTo(inBuf, 0);
        BitConverter.GetBytes((uint)args.Length).CopyTo(inBuf, 4);
        Array.Copy(args, 0, inBuf, 8, args.Length);
        var outBuf = new byte[32];
        uint ret = 0;
        if (!DeviceIoControl(h, IOCTL, inBuf, (uint)inBuf.Length, outBuf, (uint)outBuf.Length, ref ret, IntPtr.Zero))
            throw new IOException("ATKACPI " + Marshal.GetLastWin32Error());
        return outBuf;
    }

    static byte[] Dsts(uint dev, uint arg)
    {
        var a = new byte[8];
        BitConverter.GetBytes(dev).CopyTo(a, 0);
        BitConverter.GetBytes(arg).CopyTo(a, 4);
        return Call(DSTS, a);
    }

    static bool Devs(uint dev, byte[] value)
    {
        var a = new byte[4 + value.Length];
        BitConverter.GetBytes(dev).CopyTo(a, 0);
        value.CopyTo(a, 4);
        return BitConverter.ToInt32(Call(DEVS, a), 0) == 1;
    }

    // Vitesse en centaines de tr/min (comme G-Helper) ; -1 : pas de ventilateur
    static int Speed100(uint dev)
    {
        try
        {
            int v = BitConverter.ToInt32(Dsts(dev, 0), 0) - 65536;
            if (v < 0) { v += 65536; if (v <= 0 || v > 100) v = -1; }
            return v > 200 ? -1 : v;
        }
        catch { return -1; }
    }

    // Les profils sont numérotés autrement pour les courbes (Turbo ↔ Silencieux), comme dans G-Helper
    static byte[] ReadCurve(uint dev, int mode)
    {
        try
        {
            uint m = mode == 1 ? 2u : mode == 2 ? 1u : 0u;
            var b = new byte[16];
            Array.Copy(Dsts(dev, m), b, 16);
            return b;
        }
        catch { return null; }
    }

    public static bool Valid(byte[] c)
    {
        if (c == null || c.Length != 16) return false;
        bool any = false;
        for (int i = 0; i < 16; i++) if (c[i] != 0) any = true;
        if (!any) return false;
        for (int i = 0; i < 8; i++)
        {
            if (c[i] > 120 || c[8 + i] > 100) return false;
            if (i > 0 && c[i] <= c[i - 1]) return false;
        }
        return true;
    }

    public static bool SetMode(int mode)
    {
        if (!Ok) return false;
        try
        {
            bool ok = Devs(PERF, new byte[] { (byte)mode, 0, 0, 0 });
            Thread.Sleep(150);
            foreach (var f in fans) { var d = ReadCurve(f.CurveDev, mode); if (Valid(d)) f.Def = d; }
            return ok;
        }
        catch { return false; }
    }

    // Profil choisi puis courbes des ventilateurs réglés à la main : un changement de profil (ou la veille,
    // ou le branchement du chargeur sur certains modèles) remet les courbes du firmware
    public static bool Reapply()
    {
        if (!Ok) return true;
        bool custom = false;
        foreach (var f in fans) { var c = Fans.Get(f.Id); if (c != null && c.Mode != "auto") custom = true; }
        if (Fans.AsusMode < 0 && !custom && !reset) return true;
        bool ok = SetMode(Fans.AsusMode < 0 ? 0 : Fans.AsusMode);
        reset = custom;
        if (!Curves) return ok;
        foreach (var f in fans)
        {
            var c = Fans.Get(f.Id);
            if (c == null || c.Mode == "auto") continue;
            try { if (!Devs(f.CurveDev, Fans.AsusCurve(c, f.Def))) ok = false; }
            catch { ok = false; }
        }
        return ok;
    }
    static bool reset; // une courbe a été envoyée : repasser en automatique doit renvoyer le profil

    // Ventilateurs du portable, comme un composant de plus dans la photo des capteurs
    public static void Hardware(StringBuilder sb, ref bool first)
    {
        if (!Ok) return;
        if (!first) sb.Append(',');
        first = false;
        sb.Append("{\"id\":\"/asus-atk\",\"n\":\"Ventilateurs ASUS\",\"k\":\"AsusAtk\",\"p\":null,\"s\":[");
        for (int i = 0; i < fans.Count; i++)
        {
            var f = fans[i];
            f.Rpm = Speed100(f.Speed);
            if (i > 0) sb.Append(',');
            sb.Append("{\"n\":").Append(Hw.Str(f.Name)).Append(",\"k\":\"Fan\",\"i\":").Append(i)
              .Append(",\"id\":").Append(Hw.Str(f.Id)).Append(",\"v\":").Append(f.Rpm < 0 ? "null" : (f.Rpm * 100).ToString(CultureInfo.InvariantCulture))
              .Append(",\"max\":null}");
        }
        sb.Append("]}");
    }

    public static string Json(int mode)
    {
        if (!Ok) return "null";
        var sb = new StringBuilder("{\"mode\":").Append(mode).Append(",\"curves\":").Append(Curves ? "true" : "false").Append(",\"fans\":[");
        for (int i = 0; i < fans.Count; i++)
        {
            var f = fans[i];
            if (i > 0) sb.Append(',');
            sb.Append("{\"id\":").Append(Hw.Str(f.Id)).Append(",\"n\":").Append(Hw.Str(f.Name));
            if (Valid(f.Def))
            {
                var t = new string[8];
                var p = new string[8];
                for (int k = 0; k < 8; k++) { t[k] = f.Def[k].ToString(CultureInfo.InvariantCulture); p[k] = f.Def[8 + k].ToString(CultureInfo.InvariantCulture); }
                sb.Append(",\"def\":{\"t\":[").Append(string.Join(",", t)).Append("],\"p\":[").Append(string.Join(",", p)).Append("]}");
            }
            sb.Append('}');
        }
        return sb.Append("]}").ToString();
    }
}

// Le service règle lui-même son démarrage : automatique (différé) tant qu'un ventilateur est piloté,
// manuel sinon. Le compte système a ce droit sur le service (SDDL de src-tauri/src/sensors.rs).
public static class Svc
{
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr OpenSCManager(string machine, string db, uint access);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr OpenService(IntPtr scm, string name, uint access);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ChangeServiceConfig(IntPtr svc, uint type, uint start, uint error, string path, string group,
        IntPtr tag, string deps, string user, string pw, string display);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool ChangeServiceConfig2(IntPtr svc, uint level, ref int info);
    [DllImport("advapi32.dll")]
    static extern bool CloseServiceHandle(IntPtr h);

    const uint NO_CHANGE = 0xFFFFFFFF;

    public static bool SetAuto(bool auto)
    {
        IntPtr scm = OpenSCManager(null, null, 1);
        if (scm == IntPtr.Zero) return false;
        try
        {
            IntPtr s = OpenService(scm, "PeriphHubSensors", 2); // SERVICE_CHANGE_CONFIG
            if (s == IntPtr.Zero) return false;
            try
            {
                if (!ChangeServiceConfig(s, NO_CHANGE, auto ? 2u : 3u, NO_CHANGE, null, null, IntPtr.Zero, null, null, null, null)) return false;
                int delayed = auto ? 1 : 0;
                ChangeServiceConfig2(s, 3, ref delayed); // SERVICE_CONFIG_DELAYED_AUTO_START_INFO
                return true;
            }
            finally { CloseServiceHandle(s); }
        }
        finally { CloseServiceHandle(scm); }
    }
}
