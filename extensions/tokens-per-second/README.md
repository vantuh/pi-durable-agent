# Tokens per second

Shows under the composer the output speed of the last answer: `42 tok/s`.

## Usage

The chip sits in the composer status row. Its title gives the exact rate. It has no tool, hook or
setting; turn it off with its switch in the Extensions dialog.

## Behavior

- Output tokens of the newest assistant answer divided by its `durationMs`, the time from the
  request's start to its last token. Under 10 tok/s the chip shows one decimal; the title always does.
- Only the newest answer counts. If it is too short, the chip is absent; it does not fall back to an
  older one.
- It reads fields every committed answer already carries.

## Limits

- The wait for the first token is included, because the answer record does not separate it. A slow
  start lowers the number.
- For that reason an answer shorter than 250 ms or with fewer than 20 output tokens shows nothing.
