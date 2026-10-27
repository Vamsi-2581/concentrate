import type { ILanguageParser } from "../contracts/language-parser.js";
import type { ILanguageResolver } from "../contracts/language-resolver.js";
import type { ISemanticContributor } from "../contracts/semantic-contributor.js";

export class CoreIntegrationRegistry {
  private readonly parsersByLanguage = new Map<string, ILanguageParser>();
  private readonly languageResolverList: ILanguageResolver[] = [];
  private readonly semanticContributorList: ISemanticContributor[] = [];

  // One parser per language; registering a language again replaces its parser.
  registerLanguageParser(parser: ILanguageParser): void {
    this.parsersByLanguage.set(parser.language, parser);
  }

  getLanguageParser(language: string): ILanguageParser {
    const parser = this.parsersByLanguage.get(language);
    if (!parser) {
      throw new Error(`No parser registered for language: ${language}`);
    }
    return parser;
  }

  get languageParsers(): ReadonlyMap<string, ILanguageParser> {
    return this.parsersByLanguage;
  }

  registerLanguageResolver(resolver: ILanguageResolver): void {
    this.languageResolverList.push(resolver);
  }

  get languageResolvers(): readonly ILanguageResolver[] {
    return this.languageResolverList;
  }

  registerSemanticContributor(contributor: ISemanticContributor): void {
    this.semanticContributorList.push(contributor);
  }

  get semanticContributors(): readonly ISemanticContributor[] {
    return this.semanticContributorList;
  }
}
