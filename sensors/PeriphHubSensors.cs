// Capteurs de PeriphHub : températures, ventilateurs et charge du processeur, de la carte mère, des cartes
// graphiques et des disques, lus par LibreHardwareMonitorLib (MPL-2.0, https://github.com/LibreHardwareMonitor).
//
// Windows ne laisse lire les puces de la carte mère et les registres du processeur qu'à un administrateur,
// avec un pilote du noyau (PawnIO, signé). Ce programme tourne donc en service Windows « PeriphHubSensors »
// (compte système), installé une fois pour toutes avec l'accord de l'utilisateur
// (`periphhub.exe --sensors-service install`, src-tauri/src/sensors.rs).
//
//   - Démarrage À LA DEMANDE : PeriphHub le lance en ouvrant la page Températures (le service autorise
//     les utilisateurs du PC à le démarrer, rien d'autre). Il s'arrête de lui-même 3 minutes après la
//     dernière lecture : aucune mémoire occupée le reste du temps.
//   - LECTURE SEULE : il ne pilote aucun ventilateur et n'accepte aucune commande. Il publie une photo des
//     capteurs (JSON) sur le canal nommé \\.\pipe\PeriphHubSensors, lisible par les utilisateurs du PC,
//     non modifiable.
//   - Ni mémoire vive (bus SMBus, déjà utilisé par l'éclairage OpenRGB), ni contrôleurs USB (watercoolings,
//     alimentations : PeriphHub les pilote lui-même), ni réseau : deux logiciels sur la même puce se
//     mélangeraient les échanges.
//
// Compilé par scripts/fetch-sensors.ps1 avec le compilateur C# livré dans Windows (.NET Framework 4.8) :
// pas de SDK à installer, syntaxe C# 5.
//
// `PeriphHubSensors.exe --once` : une lecture, affichée dans la console (essai sans service).
using System;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;
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
    const long IDLE_MS = 180000;
    volatile bool stopping;
    long lastAsk;
    string latest = "{\"v\":1,\"ready\":false}";
    readonly object gate = new object();
    Thread worker, server;

    public SensorsService()
    {
        ServiceName = "PeriphHubSensors";
        CanStop = true;
        CanShutdown = true;
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
        worker.Start();
        server.Start();
    }

    protected override void OnStop()
    {
        stopping = true;
        if (server != null) server.Join(2000);
        if (worker != null) worker.Join(5000);
        try { Hw.Close(); } catch { }
    }

    protected override void OnShutdown()
    {
        OnStop();
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
            Hw.Open();
        }
        catch (Exception e)
        {
            Set("{\"v\":1,\"ready\":true,\"error\":" + Hw.Str(e.GetType().Name + ": " + e.Message) + ",\"hw\":[]}");
            return;
        }
        while (!stopping)
        {
            try { Set(Hw.Snapshot()); }
            catch (Exception e) { Set("{\"v\":1,\"ready\":true,\"error\":" + Hw.Str(e.GetType().Name + ": " + e.Message) + ",\"hw\":[]}"); }
            if (Now() - Interlocked.Read(ref lastAsk) > IDLE_MS)
            {
                // Plus personne ne lit : le service s'arrête (Stop() depuis un autre fil, OnStop attend celui-ci)
                new Thread(Stop) { IsBackground = true }.Start();
                return;
            }
            for (int i = 0; i < 20 && !stopping; i++) Thread.Sleep(100);
        }
    }

    void Serve()
    {
        var ps = new PipeSecurity();
        ps.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        ps.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
            PipeAccessRights.Read | PipeAccessRights.Synchronize, AccessControlType.Allow));
        ps.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null),
            PipeAccessRights.Read | PipeAccessRights.Synchronize, AccessControlType.Allow));
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
}

public static class Hw
{
    static Computer pc;
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

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

    static string Num(float? v)
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
        sb.Append("{\"v\":1,\"ready\":true,\"lib\":\"LibreHardwareMonitor 0.9.6\",\"hw\":[");
        bool first = true;
        foreach (IHardware h in pc.Hardware)
            Add(h, null, sb, ref first);
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
            if (!f) sb.Append(',');
            f = false;
            sb.Append("{\"n\":").Append(Str(s.Name))
              .Append(",\"k\":").Append(Str(s.SensorType.ToString()))
              .Append(",\"i\":").Append(s.Index.ToString(Inv))
              .Append(",\"v\":").Append(Num(s.Value))
              .Append(",\"max\":").Append(Num(s.Max))
              .Append('}');
        }
        sb.Append("]}");
        foreach (IHardware sub in h.SubHardware)
            Add(sub, h.Identifier.ToString(), sb, ref first);
    }
}
