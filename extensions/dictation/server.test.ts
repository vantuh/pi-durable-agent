import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import { MAX_BYTES, Parts, toSamples } from "./parts.ts";
import { candidates, Dictation, models } from "./server.ts";
import { DictationStore } from "./store.ts";

const run = promisify(execFile);

/** Said into the microphone for the one real transcription below. */
const PHRASE = "Ось тест диктування українською";

async function tempDir(name: string): Promise<string> {
    return await mkdtemp(join(tmpdir(), `${name}-`));
}

function skipReason(): string | undefined {
    if (!existsSync("/usr/bin/say")) {
        return "macOS `say` is not here, so the recording cannot be made";
    }

    const first = candidates()[0];

    if (first === undefined) {
        return "no Handy whisper GGUF under ~/.cache/huggingface/hub";
    }

    return existsSync(first) ? undefined : `the whisper model ${first} is not here`;
}

/** The mono 16-bit PCM of a WAV file: `say` writes a JUNK chunk first, so the data is not at a fixed offset. */
async function wavPcm(file: string): Promise<Buffer> {
    const wav = await readFile(file);
    let format: Buffer | undefined;
    let data: Buffer | undefined;
    let at = 12;

    while (at + 8 <= wav.length) {
        const id = wav.toString("ascii", at, at + 4);
        const size = wav.readUInt32LE(at + 4);

        if (id === "fmt ") {
            format = wav.subarray(at + 8, at + 8 + size);
        }

        if (id === "data") {
            data = wav.subarray(at + 8, at + 8 + size);
        }

        at += 8 + size + (size % 2);
    }

    assert.ok(format, "the WAV has a fmt chunk");
    assert.ok(data, "the WAV has a data chunk");
    assert.deepEqual(
        {
            channels: format.readUInt16LE(2),
            rate: format.readUInt32LE(4),
            bits: format.readUInt16LE(14),
        },
        { channels: 1, rate: 16_000, bits: 16 },
        "the test records what the browser sends",
    );

    return data;
}

/** The phrase through `say`, as the raw PCM a recorder would hand over. */
async function spoken(dir: string): Promise<Buffer> {
    const file = join(dir, "speech.wav");

    await run("say", ["-o", file, "--data-format=LEI16@16000", "-v", "Lesya", PHRASE]);

    return await wavPcm(file);
}

void describe("toSamples", () => {
    void it("turns little-endian 16-bit PCM into what the model takes", () => {
        const pcm = Buffer.from([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0x00, 0x40]);
        const samples = toSamples(pcm);

        assert.equal(samples.length, 4);
        assert.equal(samples[0], 0);
        assert.equal(samples[1], 32767 / 32768, "the largest positive sample");
        assert.equal(samples[2], -1, "the most negative sample is the int16 minimum");
        assert.equal(samples[3], 0.5);
    });
});

void describe("parts", () => {
    void it("joins the parts in their number order, whatever order they arrive in", () => {
        const parts = new Parts();
        const now = Date.now();

        parts.add("abcd1234", 2, Buffer.from([5, 6]), now);
        parts.add("abcd1234", 0, Buffer.from([1, 2]), now);
        parts.add("abcd1234", 1, Buffer.from([3, 4]), now);

        assert.deepEqual(parts.take("abcd1234"), Buffer.from([1, 2, 3, 4, 5, 6]));
        assert.equal(parts.take("abcd1234"), undefined, "a recording is sent once");
    });

    void it("counts a part sent twice once", () => {
        const parts = new Parts();
        const now = Date.now();

        assert.equal(parts.add("abcd1234", 0, Buffer.alloc(1000), now), 1000);
        assert.equal(parts.add("abcd1234", 0, Buffer.alloc(1000), now), 1000);
    });

    void it("drops a recording that grew past the cap", () => {
        const parts = new Parts();
        const now = Date.now();

        assert.throws(() => parts.add("abcd1234", 0, Buffer.alloc(MAX_BYTES + 1), now), /too long/);
        assert.equal(parts.take("abcd1234"), undefined);
    });

    void it("drops a recording the browser stopped sending to", () => {
        const parts = new Parts();
        const now = Date.now();

        parts.add("stale123", 0, Buffer.from([1, 2]), now);
        parts.add("fresh123", 0, Buffer.from([3, 4]), now + 11 * 60_000);

        assert.equal(parts.take("stale123"), undefined);
        assert.deepEqual(parts.take("fresh123"), Buffer.from([3, 4]));
    });
});

void describe("the settings", () => {
    let dir: string;
    let store: DictationStore;

    beforeEach(async () => {
        dir = await tempDir("dictation-settings");
        store = new DictationStore(dir);
    });

    void it("is uk, the first model found and ten idle minutes before anyone chose", async () => {
        assert.deepEqual(await store.read(), {
            version: 1,
            language: "uk",
            model: null,
            idleMinutes: 10,
        });
    });

    void it("takes a file written before the model and the idle time were settings", async () => {
        await writeFile(
            join(dir, "dictation.json"),
            JSON.stringify({ version: 1, language: "en" }),
        );

        assert.deepEqual(await store.read(), {
            version: 1,
            language: "en",
            model: null,
            idleMinutes: 10,
        });
    });

    void it("comes back as all three fields were saved", async () => {
        await store.write({
            language: "en",
            model: "/models/whisper-large-v3-turbo-Q8_0.gguf",
            idleMinutes: 0,
        });

        assert.deepEqual(JSON.parse(await readFile(join(dir, "dictation.json"), "utf8")), {
            version: 1,
            language: "en",
            model: "/models/whisper-large-v3-turbo-Q8_0.gguf",
            idleMinutes: 0,
        });
        assert.deepEqual(await store.read(), {
            version: 1,
            language: "en",
            model: "/models/whisper-large-v3-turbo-Q8_0.gguf",
            idleMinutes: 0,
        });
    });

    void it("takes auto, which leaves the language to the model", async () => {
        const saved = { version: 1, language: "auto", model: null, idleMinutes: 10 };

        await writeFile(join(dir, "dictation.json"), JSON.stringify(saved));

        assert.deepEqual(await store.read(), saved);
    });

    void it("refuses a file whose language or version it does not know", async () => {
        await writeFile(
            join(dir, "dictation.json"),
            JSON.stringify({ version: 1, language: "fr", model: null, idleMinutes: 10 }),
        );
        await assert.rejects(store.read(), /unknown shape/);

        await writeFile(
            join(dir, "dictation.json"),
            JSON.stringify({ version: 2, language: "uk", model: null, idleMinutes: 10 }),
        );
        await assert.rejects(store.read(), /unknown shape/);
    });

    void it("refuses an idle time that is not 0 to 1440 minutes", async () => {
        // `NaN` goes over the wire as `null`, which is what the browser sends for a half-typed number.
        for (const idleMinutes of [-1, 1441, Number.NaN]) {
            await writeFile(
                join(dir, "dictation.json"),
                JSON.stringify({ version: 1, language: "uk", model: null, idleMinutes }),
            );
            await assert.rejects(
                store.read(),
                /unknown shape/,
                `idleMinutes ${String(idleMinutes)} is refused`,
            );
        }
    });

    void it("refuses a model that is not a .gguf path", async () => {
        for (const model of ["", "/tmp/model.bin"]) {
            await writeFile(
                join(dir, "dictation.json"),
                JSON.stringify({ version: 1, language: "uk", model, idleMinutes: 10 }),
            );
            await assert.rejects(store.read(), /unknown shape/, `model ${model} is refused`);
        }
    });

    void it("lets the last of two writes win", async () => {
        await Promise.all([
            store.write({ language: "en", model: null, idleMinutes: 10 }),
            store.write({ language: "auto", model: null, idleMinutes: 5 }),
        ]);

        const saved = await store.read();

        assert.equal(saved.language, "auto");
        assert.equal(saved.idleMinutes, 5);
    });
});

void describe("candidates", () => {
    /** A GGUF in the shape Handy's cache keeps it: a repo, a snapshot, the file. */
    async function handy(hub: string, repo: string, file: string): Promise<void> {
        const dir = join(hub, `models--handy-computer--whisper-${repo}`, "snapshots", "5eaf945c");

        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, file), "");
    }

    void it("answers nothing when there is no hub folder", () => {
        assert.deepEqual(candidates(join(tmpdir(), "pi-durable-no-hub-at-all")), []);
    });

    void it("lists the whisper GGUFs, the large-v3-turbo Q8_0 first", async () => {
        const hub = await tempDir("dictation-hub");

        try {
            await handy(hub, "small-gguf", "whisper-small-q5_1.gguf");
            await handy(hub, "large-v3-turbo-gguf", "whisper-large-v3-turbo-Q5_K_M.gguf");
            await handy(hub, "large-v3-turbo-gguf", "whisper-large-v3-turbo-Q8_0.gguf");
            // Not a whisper GGUF, or not a GGUF at all: neither is offered.
            await handy(hub, "small-gguf", "whisper-small.ggml");
            await mkdir(join(hub, "models--mlx-community--whisper-large-v3-turbo"), {
                recursive: true,
            });
            await mkdir(join(hub, "models--mlx-community--whisper-large-v3-turbo", "snapshots"), {
                recursive: true,
            });
            await writeFile(
                join(
                    hub,
                    "models--mlx-community--whisper-large-v3-turbo",
                    "snapshots",
                    "other.gguf",
                ),
                "",
            );

            assert.deepEqual(
                candidates(hub).map((path) => basename(path)),
                [
                    "whisper-large-v3-turbo-Q8_0.gguf",
                    "whisper-large-v3-turbo-Q5_K_M.gguf",
                    "whisper-small-q5_1.gguf",
                ],
            );
        } finally {
            await rm(hub, { recursive: true, force: true });
        }
    });

    void it("lists each candidate with its file name and size in whole megabytes", async () => {
        const hub = await tempDir("dictation-models");

        try {
            const repo = join(
                hub,
                "models--handy-computer--whisper-large-v3-turbo-gguf",
                "snapshots",
            );
            const path = join(repo, "5eaf945c", "whisper-large-v3-turbo-Q8_0.gguf");

            await mkdir(join(repo, "5eaf945c"), { recursive: true });
            await writeFile(path, Buffer.alloc(2 * 1024 * 1024));

            assert.deepEqual(models(hub), [
                { path, name: "whisper-large-v3-turbo-Q8_0.gguf", megabytes: 2 },
            ]);
        } finally {
            await rm(hub, { recursive: true, force: true });
        }
    });
});

void describe("the model", () => {
    void it(
        "transcribes a Ukrainian recording on this machine",
        { skip: skipReason() },
        async () => {
            const dir = await tempDir("dictation-model");
            const local = new Dictation(dir);

            try {
                const text = await local.text(await spoken(dir));

                assert.match(text.toLowerCase(), /диктування/, `recognised: ${text}`);
            } finally {
                local.dispose();
                await rm(dir, { recursive: true, force: true });
            }
        },
    );
});
