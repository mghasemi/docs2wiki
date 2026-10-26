import { GitHubWikiAdapter } from "./githubWikiAdapter.js";
import { LocalAdapter } from "./localAdapter.js";
import { ReadTheDocsAdapter } from "./readTheDocsAdapter.js";
import { ConsolidationInput, SourceAdapter } from "../types.js";

export function pickAdapter(input: ConsolidationInput): SourceAdapter {
  switch (input.sourceKind) {
    case "github-wiki":
      return new GitHubWikiAdapter();
    case "local":
      return new LocalAdapter();
    case "readthedocs":
      return new ReadTheDocsAdapter();
    default: {
      const neverReached: never = input.sourceKind;
      throw new Error(`Unsupported source type: ${String(neverReached)}`);
    }
  }
}
