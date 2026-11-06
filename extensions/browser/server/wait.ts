export const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
