let context: AudioContext | undefined;

/** A short tone: rising when dictation starts, falling when it ends. */
export function beep(rising: boolean): void {
    context ??= new AudioContext();

    const now = context.currentTime;
    const [from, to] = rising ? [660, 880] : [880, 660];
    const tone = context.createOscillator();
    const volume = context.createGain();

    void context.resume();
    tone.frequency.setValueAtTime(from, now);
    tone.frequency.setValueAtTime(to, now + 0.08);
    volume.gain.setValueAtTime(0.0001, now);
    volume.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    volume.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    tone.connect(volume).connect(context.destination);
    tone.start(now);
    tone.stop(now + 0.17);
}
