// Player position over a walkthrough (spec §5.2). No `vscode` import.
import { Step, Walkthrough } from "./walkthrough";

/**
 * Position 0 is the overview (title + summary); positions 1..N are steps.
 */
export class Session {
  private pos = 0;

  constructor(
    public walkthrough: Walkthrough,
    /** Workspace-relative path of the walkthrough file. */
    public readonly source: string,
  ) {}

  get position(): number {
    return this.pos;
  }

  get stepCount(): number {
    return this.walkthrough.steps.length;
  }

  /** The current step, or undefined on the overview. */
  get step(): Step | undefined {
    return this.pos === 0 ? undefined : this.walkthrough.steps[this.pos - 1];
  }

  get canGoBack(): boolean {
    return this.pos > 0;
  }

  get canGoNext(): boolean {
    return this.pos < this.stepCount;
  }

  /** Moves to `position`, clamped to 0..N. Returns true if it changed. */
  goto(position: number): boolean {
    const next = Math.min(Math.max(0, Math.trunc(position)), this.stepCount);
    const changed = next !== this.pos;
    this.pos = next;
    return changed;
  }

  next(): boolean {
    return this.goto(this.pos + 1);
  }

  back(): boolean {
    return this.goto(this.pos - 1);
  }

  /** Swaps in a reloaded walkthrough, keeping the position when it still exists. */
  replace(walkthrough: Walkthrough): void {
    this.walkthrough = walkthrough;
    this.goto(this.pos);
  }
}
