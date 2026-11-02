export function isMagneticButtonClient(client) {
    const candidate = client;
    return typeof candidate?.setMagneticTriggerPoint === "function"
        && typeof candidate.setMagneticRapidTrigger === "function";
}
