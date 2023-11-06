import {ISettings} from "src/conf/settings";
import * as showdown from "showdown";
import {Regex} from "src/conf/regex";
import {Flashcard} from "../entities/flashcard";
import {Inlinecard} from "src/entities/inlinecard";
import {Spacedcard} from "src/entities/spacedcard";
import {Clozecard} from "src/entities/clozecard";
import {escapeMarkdown} from "src/utils";
import {match} from "minimatch";

import lucideAltTriangle from "../assets/svg/lucide-alt-triangle.svg";
import lucideBug from "../assets/svg/lucide-bug.svg";
import lucideCheckCircle2 from "../assets/svg/lucide-check-circle-2.svg";
import lucideChk from "../assets/svg/lucide-chk.svg";
import lucideClipboardList from "../assets/svg/lucide-clipboard-list.svg";
import lucideFle from "../assets/svg/lucide-fle.svg";
import lucideHeCircle from "../assets/svg/lucide-he-circle.svg";
import lucideInfo from "../assets/svg/lucide-info.svg";
import lucideLit from "../assets/svg/lucide-lit.svg";
import lucidePencil from "../assets/svg/lucide-pencil.svg";
import lucideQue from "../assets/svg/lucide-que.svg";
import lucideX from "../assets/svg/lucide-x.svg";
import lucideZap from "../assets/svg/lucide-zap.svg";



export class Parser {
  private regex: Regex;
  private settings: ISettings;
  private htmlConverter;

  constructor(regex: Regex, settings: ISettings) {
    this.regex = regex;
    this.settings = settings;
    this.htmlConverter = new showdown.Converter();
    this.htmlConverter.setOption("simplifiedAutoLink", true);
    this.htmlConverter.setOption("tables", true);
    this.htmlConverter.setOption("tasks", true);
    this.htmlConverter.setOption("strikethrough", true);
    this.htmlConverter.setOption("ghCodeBlocks", true);
    this.htmlConverter.setOption("requireSpaceBeforeHeadingText", true);
    this.htmlConverter.setOption("simpleLineBreaks", true);
  }

  public generateFlashcards(file: string, deck: string, vault: string, note: string, globalTags: string[] = []): Flashcard[] {
    const contextAware = this.settings.contextAwareMode;
    let cards: Flashcard[] = [];
    const headings: any = [];

    if (contextAware) {
      let inCodeBlock = false;
      let currentIndex = 0;

      file.split('\n').forEach(line => {
        // Check for code block start or end
        if (line.trim().startsWith('```')) {
          inCodeBlock = !inCodeBlock;
        }

        // Skip lines in code blocks
        if (inCodeBlock) {
          currentIndex += line.length + 1; // update index, +1 for the newline character
          return;
        }

        // Match only if not in a code block
        const match = line.match(/^ {0,3}(#{1,6}) +([^\n]+?) ?((?: *#\S+)*) *$/);
        if (match) {
          match.index = currentIndex; // Manually set index
          headings.push(match);
        }

        currentIndex += line.length + 1; // update index, +1 for the newline character
      });
    }

    note = this.substituteObsidianLinks(`[[${note}]]`, vault);
    cards = cards.concat(this.generateCardsWithTag(file, headings, deck, vault, note, globalTags));
    cards = cards.concat(this.generateInlineCards(file, headings, deck, vault, note, globalTags));
    cards = cards.concat(this.generateSpacedCards(file, headings, deck, vault, note, globalTags));
    cards = cards.concat(this.generateClozeCards(file, headings, deck, vault, note, globalTags));

    // Filter out cards that are fully inside a code block, a math block or a math inline block
    const codeBlocks = [...file.matchAll(this.regex.obsidianCodeBlock)];
    const mathBlocks = [...file.matchAll(this.regex.mathBlock)];
    const mathInline = [...file.matchAll(this.regex.mathInline)];
    const blocksToFilter = [...codeBlocks, ...mathBlocks, ...mathInline];
    const rangesToDiscard = blocksToFilter.map(x => ([x.index, x.index + x[0].length]))
    cards = cards.filter(card => {
      const cardRange = [card.initialOffset, card.endOffset];
      const isInRangeToDiscard = rangesToDiscard.some(range => {
        return (cardRange[0] >= range[0] && cardRange[1] <= range[1]);
      });
      return !isInRangeToDiscard;
    });

    cards.sort((a, b) => a.endOffset - b.endOffset);

    const defaultAnkiTag = this.settings.defaultAnkiTag;
    if (defaultAnkiTag) {
      for (const card of cards) {
        card.tags.push(defaultAnkiTag);
      }
    }

    return cards;
  }

  public containsCode(str: string[]): boolean {
    for (const s of str) {
      if (s.match(this.regex.codeBlock)) {
        return true;
      }
    }
    return false;
  }

  public getCardsToDelete(file: string): number[] {
    // Find block IDs with no content above it
    return [...file.matchAll(this.regex.cardsToDelete)].map((match) => {
      return Number(match[1]);
    });
  }

  public getAnkiIDsBlocks(file: string): RegExpMatchArray[] {
    return Array.from(file.matchAll(/\^(\d{13})\s*/gm));
  }

  /**
   * Gives back the ancestor headings of a line.
   * @param headings The list of all the headings available in a file. Expected to be an array of match objects from String.matchAll().
   * @param index The index of the line whose ancestors need to be calculated.
   * @param headingLevel The level of the heading for the line if the line is itself a heading (number of '#'), or -1 if it's a paragraph.
   * @returns An array of strings, each representing an ancestor heading text.
   */
  private getContext(headings: any, index: number, headingLevel: number): string[] {
    const context: string[] = [];
    let currentIndex: number = index;
    let currentLevel: number = headingLevel === -1 ? 6 : headingLevel - 1; // Initialize to 6 if headingLevel is -1

    // Iterate over each heading from the last to the first
    for (let i = headings.length - 1; i >= 0; i--) {
      const heading = headings[i];
      const headingIndex = heading.index;
      const headingLevel = heading[1].length;

      // Check if the heading is an ancestor of the current line
      if (headingIndex < currentIndex && headingLevel <= currentLevel) {
        // Update the current index and level
        currentIndex = headingIndex;
        currentLevel = headingLevel - 1; // look for the parent of this heading next

        // Add the heading to the context
        context.unshift(heading[2].trim());
      }
    }

    return context;
  }

  private generateSpacedCards(file: string, headings: any, deck: string, vault: string, note: string, globalTags: string[] = []) {
    const contextAware = this.settings.contextAwareMode;
    const cards: Spacedcard[] = [];
    const matches = [...file.matchAll(this.regex.cardsSpacedStyle)];

    for (const match of matches) {
      const reversed = false;
      let headingLevel = -1;
      if (match[1]) {
        headingLevel = match[1].trim().length !== 0 ? match[1].trim().length : -1;
      }
      // Match.index - 1 because otherwise in the context there will be even match[1], i.e. the question itself
      const context = contextAware ? this.getContext(headings, match.index - 1, headingLevel) : "";

      const originalPrompt = match[2].trim();
      let prompt = contextAware ? [...context, match[2].trim()].join(`${this.settings.contextSeparator}`) : match[2].trim();
      let medias: string[] = this.getImageLinks(prompt);
      medias = medias.concat(this.getAudioLinks(prompt));
      prompt = this.parseLine(prompt, vault);

      const initialOffset = match.index;
      const endingLine = match.index + match[0].length;
      const tags: string[] = this.parseTags(match[4], globalTags);
      const id: number = match[5] ? Number(match[5]) : -1;
      const inserted: boolean = match[5] ? true : false;
      const fields: any = {Prompt: prompt};
      if (this.settings.sourceSupport) {
        fields["Source"] = note;
      }
      const containsCode = this.containsCode([prompt]);

      const card = new Spacedcard(id, deck, originalPrompt, fields, reversed, initialOffset, endingLine, tags, inserted, medias, containsCode);
      cards.push(card);
    }

    return cards;
  }

  private generateClozeCards(file: string, headings: any, deck: string, vault: string, note: string, globalTags: string[] = []) {
    const contextAware = this.settings.contextAwareMode;
    const cards: Clozecard[] = [];
    const matches = [...file.matchAll(this.regex.cardsClozeWholeLine)];

    const mathBlocks = [...file.matchAll(this.regex.mathBlock)];
    const mathInline = [...file.matchAll(this.regex.mathInline)];
    const blocksToFilter = [...mathBlocks, ...mathInline];
    const rangesToDiscard = blocksToFilter.map(x => ([x.index, x.index + x[0].length]))

    for (const match of matches) {
      const reversed = false;
      let headingLevel = -1;
      if (match[1]) {
        headingLevel = match[1].trim().length !== 0 ? match[1].trim().length : -1;
      }
      // Match.index - 1 because otherwise in the context there will be even match[1], i.e. the question itself
      const context = contextAware ? this.getContext(headings, match.index - 1, headingLevel) : "";

      // If all the curly clozes are inside a math block, then do not create the card
      const curlyClozes = match[2].matchAll(this.regex.singleClozeCurly);
      const matchIndex = match.index;
      // Identify curly clozes, drop all the ones that are in math blocks i.e. ($\frac{1}{12}$) and substitute the others with Anki syntax
      let clozeText = match[2].replace(this.regex.singleClozeCurly, (match, g1, g2, g3, offset) => {
        const globalOffset = matchIndex + offset;
        const isInMathBlock = rangesToDiscard.some(x => (globalOffset >= x[0] && globalOffset + match[0].length <= x[1]));
        if (isInMathBlock) {
          return match;
        } else {
          if (g2) {
            return `{{c${g2}::${g3}}}`;
          } else {
            return `{{c1::${g3}}}`;
          }
        }
      });

      // Replace the highlight clozes in the line with Anki syntax
      clozeText = clozeText.replace(this.regex.singleClozeHighlight, "{{c1::$2}}");

      if (clozeText === match[2]) {
        // If the clozeText is the same as the match it means that the curly clozes were all in math blocks
        continue;
      }

      const originalLine = match[2].trim();

      // Make a new context to add padding to make card generation uniform
      const clozeText_padded = '<br>\n' + clozeText;


      // Add context
      clozeText = contextAware ? [...context, clozeText_padded.trim()].join(`${this.settings.contextSeparator}`) : clozeText_padded.trim();

      console.log("Context: ");
      console.log(context);

      let medias: string[] = this.getImageLinks(clozeText);
      medias = medias.concat(this.getAudioLinks(clozeText));
      clozeText = this.parseLine(clozeText, vault);

      const initialOffset = match.index;
      const endingLine = match.index + match[0].length;
      const tags: string[] = this.parseTags(match[4], globalTags);
      const id: number = match[5] ? Number(match[5]) : -1;
      const inserted: boolean = match[5] ? true : false;
      const fields: any = {Text: clozeText, Extra: ""};
      if (this.settings.sourceSupport) {
        fields["Source"] = note;
      }
      const containsCode = this.containsCode([clozeText]);

      const card = new Clozecard(id, deck, originalLine, fields, reversed, initialOffset, endingLine, tags, inserted, medias, containsCode);
      cards.push(card);
    }

    return cards;
  }

  private generateInlineCards(file: string, headings: any, deck: string, vault: string, note: string, globalTags: string[] = []) {
    const contextAware = this.settings.contextAwareMode;
    const cards: Inlinecard[] = [];
    const matches = [...file.matchAll(this.regex.cardsInlineStyle)];

    for (const match of matches) {
      if (match[2].toLowerCase().startsWith("cards-deck") || match[2].toLowerCase().startsWith("tags")) {
        continue;
      }

      const reversed: boolean = match[3] === this.settings.inlineSeparatorReverse;
      let headingLevel = -1;
      if (match[1]) {
        headingLevel = match[1].trim().length !== 0 ? match[1].trim().length : -1;
      }
      // Match.index - 1 because otherwise in the context there will be even match[1], i.e. the question itself
      const context = contextAware ? this.getContext(headings, match.index - 1, headingLevel) : "";

      const originalQuestion = match[2].trim();
      let question = contextAware ? [...context, match[2].trim()].join(`${this.settings.contextSeparator}`) : match[2].trim();
      let answer = match[4].trim();
      let medias: string[] = this.getImageLinks(question);
      medias = medias.concat(this.getImageLinks(answer));
      medias = medias.concat(this.getAudioLinks(answer));
      question = this.parseLine(question, vault);
      answer = this.parseLine(answer, vault);

      const initialOffset = match.index
      const endingLine = match.index + match[0].length;
      const tags: string[] = this.parseTags(match[5], globalTags);
      const id: number = match[6] ? Number(match[6]) : -1;
      const inserted: boolean = match[6] ? true : false;
      const fields: any = {Front: question, Back: answer};
      if (this.settings.sourceSupport) {
        fields["Source"] = note;
      }
      const containsCode = this.containsCode([question, answer]);

      const card = new Inlinecard(id, deck, originalQuestion, fields, reversed, initialOffset, endingLine, tags, inserted, medias, containsCode);
      cards.push(card);
    }

    return cards;
  }

  private generateCardsWithTag(file: string, headings: any, deck: string, vault: string, note: string, globalTags: string[] = []) {
    const contextAware = this.settings.contextAwareMode;
    const cards: Flashcard[] = [];
    const matches = [...file.matchAll(this.regex.flashscardsWithTag)];

    const embedMap = this.getEmbedMap();

    for (const match of matches) {
      const reversed: boolean = match[3].trim().toLowerCase() === `#${this.settings.flashcardsTag}-reverse` || match[3].trim().toLowerCase() === `#${this.settings.flashcardsTag}/reverse`;
      const headingLevel = match[1].trim().length !== 0 ? match[1].length : -1;
      // Match.index – 1 because otherwise in the context there will be even match[1], i.e., the question itself.
      const context = contextAware ? this.getContext(headings, match.index - 1, headingLevel).concat([]) : "";

      const originalQuestion = match[2].trim();
      // let question = contextAware ? [...context, "\n", "\n", match[2].trim()].join(`${this.settings.contextSeparator}`) : match[2].trim();
      let question = "";
      if (contextAware) {
        question += "<b>≡</b> ";
        question += [... context].join(`${this.settings.contextSeparator}`);
        question += "\n";
        question += "\n";
        question += match[2].trim();
      }
      console.log("Question: ");
      console.log(question);
      let answer = match[5].trim();
      let medias: string[] = this.getImageLinks(question);
      medias = medias.concat(this.getImageLinks(answer));
      medias = medias.concat(this.getAudioLinks(answer));

      answer = this.getEmbedWrapContent(embedMap, answer);

      question = this.parseLine(question, vault);
      answer = this.parseLine(answer, vault);

      question = this.insertCallouts(question);
      answer = this.insertCallouts(answer);

      const initialOffset = match.index
      const endingLine = match.index + match[0].length;
      const tags: string[] = this.parseTags(match[4], globalTags);
      const id: number = match[6] ? Number(match[6]) : -1;
      const inserted = !!match[6];
      const fields: any = {Front: question, Back: answer};
      if (this.settings.sourceSupport) {
        fields["Source"] = note;
      }
      const containsCode = this.containsCode([question, answer]);

      const card = new Flashcard(id, deck, originalQuestion, fields, reversed, initialOffset, endingLine, tags, inserted, medias, containsCode);
      cards.push(card);
    }

    return cards;
  }

  private parseLine(str: string, vaultName: string) {
    return this.htmlConverter.makeHtml(this.mathToAnki(this.substituteObsidianLinks(this.substituteImageLinks(this.substituteAudioLinks(str)), vaultName)));
  }

  private getImageLinks(str: string) {
    const wikiMatches = str.matchAll(this.regex.wikiImageLinks);
    const markdownMatches = str.matchAll(this.regex.markdownImageLinks);
    const links: string[] = [];

    for (const wikiMatch of wikiMatches) {
      links.push(wikiMatch[1]);
    }

    for (const markdownMatch of markdownMatches) {
      links.push(decodeURIComponent(markdownMatch[1]));
    }

    return links;
  }

  private getAudioLinks(str: string) {
    const wikiMatches = str.matchAll(this.regex.wikiAudioLinks);
    const links: string[] = [];

    for (const wikiMatch of wikiMatches) {
      links.push(wikiMatch[1]);
    }

    return links;
  }

  private substituteObsidianLinks(str: string, vaultName: string) {
    const linkRegex = /\[\[(.+?)(?:\|(.+?))?\]\]/gim;
    vaultName = encodeURIComponent(vaultName);

    return str.replace(linkRegex, (match, filename, rename) => {
      const href = `obsidian://open?vault=${vaultName}&file=${encodeURIComponent(filename)}.md`;
      const fileRename = rename ? rename : filename;
      return `<a href="${href}">${fileRename}</a>`;
    });
  }

  private substituteImageLinks(str: string): string {
    str = str.replace(this.regex.wikiImageLinks, "<img src='$1'>");
    str = str.replace(this.regex.markdownImageLinks, "<img src='$1'>");

    return str;
  }

  private substituteAudioLinks(str: string): string {
    return str.replace(this.regex.wikiAudioLinks, "[sound:$1]");
  }

  private mathToAnki(str: string) {
    str = str.replace(this.regex.mathBlock, function (match, p1, p2) {
      return "\\\\[" + escapeMarkdown(p2) + " \\\\]";
    });

    str = str.replace(this.regex.mathInline, function (match, p1, p2) {
      return "\\\\(" + escapeMarkdown(p2) + "\\\\)";
    });

    return str;
  }

  private parseTags(str: string, globalTags: string[]): string[] {
    const tags: string[] = [...globalTags];

    if (str) {
      for (const tag of str.split("#")) {
        let newTag = tag.trim();
        if (newTag) {
          // Replace obsidian hierarchy tags delimeter \ with anki delimeter ::
          newTag = newTag.replace(this.regex.tagHierarchy, "::");
          tags.push(newTag);
        }
      }
    }

    return tags;
  }

  private getEmbedMap() {

    // key：link url 
    // value： embed content parse from html document
    const embedMap = new Map()

    const embedList = Array.from(document.documentElement.getElementsByClassName('internal-embed'));


    Array.from(embedList).forEach((el) => {
      // markdown-embed-content markdown-embed-page
      const embedValue = this.htmlConverter.makeMarkdown(this.htmlConverter.makeHtml(el.outerHTML).toString());

      const embedKey = el.getAttribute("src");
      embedMap.set(embedKey, embedValue);

      // console.log("embedKey: \n" + embedKey);
      // console.log("embedValue: \n" + embedValue);
    });

    return embedMap;
  }

  private getEmbedWrapContent(embedMap: Map<any, any>, embedContent: string): string {
    let result = embedContent.match(this.regex.embedBlock);
    // eslint-disable-next-line no-cond-assign
    while (result = this.regex.embedBlock.exec(embedContent)) {
      // console.log("result[0]: " + result[0]);
      // console.log("embedMap.get(result[1]): " + embedMap.get(result[1]));
      embedContent = embedContent.concat(embedMap.get(result[1]));
    }
    return embedContent;
  }

  private buildCalloutTemplate(type: string, data_callout_fold: string, label: string, content: string): string {
    let callout_content_display;
    let is_collapsed;
    if (data_callout_fold === "+") {
      callout_content_display = "block";
      is_collapsed = "is-collapsed";
    } else {
      callout_content_display = "none";
      is_collapsed = "";
    }

    // Create an interface for the callout type
    interface ICalloutType {
      [key: string]: string;
    }

    // Create a dictionary of callout icons
    const callout_icons: ICalloutType = {
      "note": lucidePencil,

      "abstract": lucideClipboardList,
      "summary": lucideClipboardList,
      "tldr": lucideClipboardList,

      "info": lucideInfo,

      "todo": lucideCheckCircle2,

      "tip": lucideFle,
      "hint": lucideFle,
      "important": lucideFle,

      "success": lucideChk,
      "check": lucideChk,
      "done": lucideChk,

      "question": lucideHeCircle,
      "help": lucideHeCircle,
      "faq": lucideHeCircle,

      "warning": lucideAltTriangle,
      "caution": lucideAltTriangle,
      "attention": lucideAltTriangle,

      "failure": lucideX,
      "fail": lucideX,
      "missing": lucideX,

      "danger": lucideZap,
      "error": lucideZap,

      "bug": lucideBug,

      "example": lucideLit,

      "quote": lucideQue,
      "cite": lucideQue
    }

    type = type.toLocaleLowerCase(); // Convert the type to lowercase to match the keys in the callout_icons dictionary

    // Get the icon for the callout type
    const callout_icon_svg = callout_icons[type] ? callout_icons[type] : lucideInfo;


    return `
      <div data-callout-metadata="" data-callout-fold="${data_callout_fold}" data-callout="${type}" class="callout is-collapsible ${is_collapsed}">
          <div class="callout-title">
              <div class="callout-icon">
                  ${callout_icon_svg}
              </div>
              <div class="callout-title-inner">${label}</div>
              <div class="callout-fold ${is_collapsed}">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-down"><polyline points="6 9 12 15 18 9">
                    </polyline>
                </svg>
              </div>
          </div>
          <div class="callout-content" style="display:${callout_content_display};">
              <p>${content}</p>
          </div>
      </div>
      `;
  }

  private replaceCalloutBlock(raw_string: string, match: RegExpMatchArray, callout_template: string): string {
    return raw_string.replace(match[0], callout_template);
  }

  private insertCallouts(raw_string: string): string {
    const matches = [...raw_string.matchAll(this.regex.calloutBlock)];
    for (const match of matches) {
      const type = match[1];
      const data_callout_fold = match[2];
      const label = match[3];
      const content = match[4];

      const callout_template = this.buildCalloutTemplate(type, data_callout_fold, label, content);
      raw_string = this.replaceCalloutBlock(raw_string, match, callout_template);
    }

    return raw_string;
  }

}
