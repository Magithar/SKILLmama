export class NotImplementedError extends Error {
  constructor(fnName: string) {
    super(
      `${fnName} is not implemented in the skillmama package yet. ` +
        `This behavior currently lives in skillmama/SKILL.md and runs only ` +
        `through an LLM agent that reads it.`
    );
    this.name = "NotImplementedError";
  }
}
