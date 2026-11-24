// Tiny stack VM, ISA v1. All values are 32-bit, wrapping.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

class Trap extends Error {
  code: number;
  constructor(code: number) {
    super('trap ' + code);
    this.code = code;
  }
}

function run(prog: Buffer, inp: Buffer): { out: number[]; code: number } {
  const stack: number[] = [];
  const mem = new Int32Array(256);
  const calls: number[] = [];
  const out: number[] = [];
  let pc = 0;
  let ip = 0;
  let steps = 0;
  const need = (n: number) => {
    if (stack.length < n) throw new Trap(2);
  };
  const push = (v: number) => {
    if (stack.length >= 256) throw new Trap(3);
    stack.push(v | 0);
  };
  const pop = (): number => {
    need(1);
    return stack.pop() as number;
  };
  const wrap = (v: number) => v | 0;
  try {
    for (;;) {
      if (steps >= 1000000) throw new Trap(10);
      if (pc < 0 || pc >= prog.length) throw new Trap(9);
      const op = prog[pc];
      const known =
        op === 0x00 || op === 0x01 || op === 0x02 || op === 0x03 ||
        op === 0x04 || op === 0x05 || op === 0x06 || op === 0x07 ||
        (op >= 0x10 && op <= 0x22) ||
        (op >= 0x30 && op <= 0x34) ||
        op === 0x40 || op === 0x41 ||
        op === 0x50 || op === 0x51 || op === 0x52 || op === 0x53;
      if (!known) throw new Trap(5);
      const imm = op === 0x01 ? 1 : op === 0x02 ? 4 : op >= 0x30 && op <= 0x33 ? 2 : 0;
      if (pc + 1 + imm > prog.length) throw new Trap(9);
      steps++;
      const next = pc + 1 + imm;
      switch (op) {
        case 0x00:
          throw new Trap(0);
        case 0x01: {
          const b = prog[pc + 1];
          pc = next;
          push(b >= 128 ? b - 256 : b);
          break;
        }
        case 0x02: {
          const v = prog.readInt32LE(pc + 1);
          pc = next;
          push(v);
          break;
        }
        case 0x03:
          pc = next;
          pop();
          break;
        case 0x04:
          need(1);
          pc = next;
          push(stack[stack.length - 1]);
          break;
        case 0x05: {
          need(2);
          pc = next;
          const b = stack.pop() as number;
          const a = stack.pop() as number;
          stack.push(b, a);
          break;
        }
        case 0x06:
          need(2);
          pc = next;
          push(stack[stack.length - 2]);
          break;
        case 0x07: {
          need(3);
          pc = next;
          const c = stack.pop() as number;
          const b = stack.pop() as number;
          const a = stack.pop() as number;
          stack.push(b, c, a);
          break;
        }
        case 0x10: case 0x11: case 0x12: case 0x13: case 0x14:
        case 0x15: case 0x16: case 0x18: case 0x19: case 0x1a:
        case 0x1c: case 0x1d: case 0x1e: case 0x20: case 0x21: case 0x22: {
          need(2);
          const b = stack.pop() as number;
          const a = stack.pop() as number;
          pc = next;
          let r = 0;
          if (op === 0x10) r = wrap(a + b);
          else if (op === 0x11) r = wrap(a - b);
          else if (op === 0x12) r = Math.imul(a, b);
          else if (op === 0x13) {
            if (b === 0) throw new Trap(4);
            r = wrap(Math.trunc(a / b));
          } else if (op === 0x14) {
            if (b === 0) throw new Trap(4);
            r = b === -1 ? 0 : a % b;
          } else if (op === 0x15) {
            if (b === 0) throw new Trap(4);
            r = wrap(Math.floor((a >>> 0) / (b >>> 0)));
          } else if (op === 0x16) {
            if (b === 0) throw new Trap(4);
            r = wrap((a >>> 0) % (b >>> 0));
          } else if (op === 0x18) r = a & b;
          else if (op === 0x19) r = a | b;
          else if (op === 0x1a) r = a ^ b;
          else if (op === 0x1c) r = a << (b & 31);
          else if (op === 0x1d) r = a >> (b & 31);
          else if (op === 0x1e) r = wrap(a >>> (b & 31));
          else if (op === 0x20) r = a === b ? 1 : 0;
          else if (op === 0x21) r = a < b ? 1 : 0;
          else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
          push(r);
          break;
        }
        case 0x17:
          need(1);
          pc = next;
          push(wrap(-(stack.pop() as number)));
          break;
        case 0x1b:
          need(1);
          pc = next;
          push(~(stack.pop() as number));
          break;
        case 0x30:
          pc = next + prog.readInt16LE(pc + 1);
          break;
        case 0x31: {
          const v = pop();
          pc = v === 0 ? next + prog.readInt16LE(pc + 1) : next;
          break;
        }
        case 0x32: {
          const v = pop();
          pc = v !== 0 ? next + prog.readInt16LE(pc + 1) : next;
          break;
        }
        case 0x33: {
          if (calls.length >= 64) throw new Trap(7);
          const target = prog.readUInt16LE(pc + 1);
          calls.push(next);
          pc = target;
          break;
        }
        case 0x34: {
          if (calls.length === 0) throw new Trap(8);
          pc = calls.pop() as number;
          break;
        }
        case 0x40: {
          need(1);
          const addr = stack.pop() as number;
          if (addr < 0 || addr > 255) throw new Trap(6);
          pc = next;
          push(mem[addr]);
          break;
        }
        case 0x41: {
          need(2);
          const addr = stack.pop() as number;
          const v = stack.pop() as number;
          if (addr < 0 || addr > 255) throw new Trap(6);
          mem[addr] = v;
          pc = next;
          break;
        }
        case 0x50: {
          need(1);
          const v = stack.pop() as number;
          const text = String(v);
          if (out.length + text.length > 65536) throw new Trap(11);
          pc = next;
          for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i));
          break;
        }
        case 0x51: {
          need(1);
          const v = stack.pop() as number;
          if (out.length + 1 > 65536) throw new Trap(11);
          pc = next;
          out.push(v & 255);
          break;
        }
        case 0x52:
          pc = next;
          push(ip < inp.length ? inp[ip++] : -1);
          break;
        case 0x53: {
          need(1);
          const v = stack.pop() as number;
          throw new Trap(v & 255);
        }
      }
    }
  } catch (e) {
    if (e instanceof Trap) return { out, code: e.code };
    throw e;
  }
}

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(inputDir).sort()) {
  const prog = readFileSync(join(inputDir, id, 'program.bin'));
  const inp = readFileSync(join(inputDir, id, 'input.bin'));
  const { out, code } = run(prog, inp);
  mkdirSync(join(outputDir, id), { recursive: true });
  writeFileSync(join(outputDir, id, 'stdout.bin'), Buffer.from(out));
  writeFileSync(join(outputDir, id, 'exit.txt'), String(code) + '\n');
}
