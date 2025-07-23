import chalk from 'chalk';
import { flatten, unflatten } from 'flat';
import * as fs from 'fs';
import * as path from 'path';
import { diff } from 'deep-object-diff';
import { omit } from 'lodash';
import ncp from 'ncp';

import { serviceMap, TranslationService } from './services';
import {
  loadTranslations,
  getAvailableLanguages,
  fixSourceInconsistencies,
  evaluateFilePath,
  FileType,
  DirectoryStructure,
  TranslatableFile,
} from './util/file-system';
import { matcherMap } from './matchers';

export interface TranslateOptions {
  inputDir?: string;
  exclude?: string;
  cacheDir?: string;
  sourceLanguage?: string;
  deleteUnusedStrings?: boolean;
  type?: FileType;
  withArrays?: boolean;
  directoryStructure?: DirectoryStructure;
  fixInconsistencies?: boolean;
  service?: keyof typeof serviceMap;
  matcher?: keyof typeof matcherMap;
  decodeEscapes?: boolean;
  config?: string;
  glossariesDir?: string | boolean;
  appName?: string;
  context?: string;
  overwrite?: boolean;
}

export const listServices = (): string[] => Object.keys(serviceMap);
export const listMatchers = (): string[] => Object.keys(matcherMap);

function createTranslator(
  translationService: TranslationService,
  service: keyof typeof serviceMap,
  sourceLang: string,
  targetLang: string,
  cacheDir: string,
  workingDir: string,
  dirStructure: DirectoryStructure,
  deleteUnusedStrings: boolean,
  withArrays: boolean,
  overwrite: boolean,
) {
  return async (
    sourceFile: TranslatableFile,
    destinationFile: TranslatableFile | undefined,
  ): Promise<[number, number]> => {
    const cachePath = path.resolve(
      evaluateFilePath(cacheDir, dirStructure, sourceLang),
      sourceFile ? sourceFile.name : '',
    );
    let cacheDiff: string[] = [];
    if (fs.existsSync(cachePath) && !fs.statSync(cachePath).isDirectory()) {
      const cachedFile = flatten(
        JSON.parse(fs.readFileSync(cachePath).toString().trim()),
      ) as any;
      const cDiff = diff(cachedFile, sourceFile.content);
      cacheDiff = Object.keys(cDiff).filter((k) => cDiff[k]);
      const changedItems = Object.keys(cacheDiff).length.toString();
      process.stdout.write(
        chalk` ({green.bold ${changedItems}} changes from cache)`,
      );
    }

    const existingKeys = destinationFile ? Object.keys(destinationFile.content) : [];
    const templateStrings = Object.keys(sourceFile.content);
    const stringsToTranslate = templateStrings
      .filter(
        (key) =>
          overwrite ||
          !existingKeys.includes(key) ||
          cacheDiff.includes(key) ||
          (typeof sourceFile.content[key] == 'string' && !destinationFile?.content[key]),
      )
      .map((key) => ({
        key,
        value: sourceFile.type === 'key-based' ? (sourceFile.content as any)[key] : key,
      }));

    const unusedStrings = existingKeys.filter((key) => !templateStrings.includes(key));

    const translatedStrings = await translationService.translateStrings(
      stringsToTranslate,
      sourceLang,
      targetLang,
    );

    const newKeys = translatedStrings.reduce(
      (acc, cur) => ({ ...acc, [cur.key]: cur.translated }),
      {} as { [k: string]: string },
    );

    if (service !== 'dry-run') {
      const existingTranslations = destinationFile ? destinationFile.content : {};

      const translatedFile = {
        ...omit(existingTranslations, deleteUnusedStrings ? unusedStrings : []),
        ...newKeys,
      };

      const newContent =
        JSON.stringify(
          sourceFile.type === 'key-based'
            ? unflatten(translatedFile, { object: !withArrays })
            : translatedFile,
          null,
          2,
        ) + `\n`;

      fs.writeFileSync(
        path.resolve(
          evaluateFilePath(workingDir, dirStructure, targetLang),
          destinationFile?.name ?? sourceFile.name,
        ),
        newContent,
      );

      const languageCachePath = evaluateFilePath(cacheDir, dirStructure, targetLang);
      if (!fs.existsSync(languageCachePath)) {
        fs.mkdirSync(languageCachePath);
      }
      fs.writeFileSync(
        path.resolve(languageCachePath, destinationFile?.name ?? sourceFile.name),
        JSON.stringify(translatedFile, null, 2) + '\n',
      );
    }

    console.log(
      deleteUnusedStrings && unusedStrings.length > 0
        ? chalk` ({green.bold +${String(translatedStrings.length)}}/{red.bold -${String(
            unusedStrings.length,
          )}})`
        : chalk` ({green.bold +${String(translatedStrings.length)}})`,
    );

    return [translatedStrings.length, deleteUnusedStrings ? unusedStrings.length : 0];
  };
}

export async function translate(options: TranslateOptions = {}): Promise<void> {
  const {
    inputDir = '.',
    exclude,
    cacheDir = '.json-autotranslate-cache',
    sourceLanguage = 'en',
    deleteUnusedStrings = false,
    type = 'auto',
    withArrays = false,
    directoryStructure = 'default',
    fixInconsistencies = false,
    service = 'google-translate',
    matcher = 'icu',
    decodeEscapes = false,
    config,
    glossariesDir,
    appName,
    context,
    overwrite = false,
  } = options;

  const workingDir = path.resolve(process.cwd(), inputDir);
  const resolvedCacheDir = path.resolve(process.cwd(), cacheDir);
  const availableLanguages = getAvailableLanguages(workingDir, directoryStructure);
  const targetLanguages = availableLanguages.filter((f) => f !== sourceLanguage);

  if (!fs.existsSync(resolvedCacheDir)) {
    fs.mkdirSync(resolvedCacheDir);
    console.log(`🗂 Created the cache directory.`);
  }

  if (!availableLanguages.includes(sourceLanguage)) {
    throw new Error(`The source language ${sourceLanguage} doesn't exist.`);
  }

  if (typeof serviceMap[service] === 'undefined') {
    throw new Error(`The service ${service} doesn't exist.`);
  }

  if (typeof matcherMap[matcher] === 'undefined') {
    throw new Error(`The matcher ${matcher} doesn't exist.`);
  }

  const translationService = serviceMap[service];

  const templateFilePath = evaluateFilePath(
    workingDir,
    directoryStructure,
    sourceLanguage,
  );

  const templateFiles = loadTranslations(
    templateFilePath,
    exclude,
    type,
    withArrays,
  );

  if (templateFiles.length === 0) {
    throw new Error(`The source language ${sourceLanguage} doesn't contain any JSON files.`);
  }

  console.log(
    chalk`Found {green.bold ${String(targetLanguages.length)}} target language(s):`,
  );
  console.log(`-> ${targetLanguages.join(', ')}`);
  console.log();

  console.log(`🏭 Loading source files...`);
  for (const file of templateFiles) {
    console.log(chalk`├── ${String(file.name)} (${file.type})`);
  }
  console.log(chalk`└── {green.bold Done}`);
  console.log();

  console.log(`✨ Initializing ${translationService.name}...`);
  await translationService.initialize(
    config,
    matcherMap[matcher],
    decodeEscapes,
    glossariesDir,
    appName,
    context,
  );
  console.log(chalk`└── {green.bold Done}`);
  console.log();

  if (!translationService.supportsLanguage(sourceLanguage)) {
    throw new Error(
      `${translationService.name} doesn't support the source language ${sourceLanguage}`,
    );
  }

  console.log(`🔍 Looking for key-value inconsistencies in source files...`);
  const inconsistentFiles: string[] = [];

  for (const file of templateFiles.filter((f) => f.type === 'natural')) {
    const inconsistentKeys = Object.keys(file.content).filter((key) => key !== (file.content as any)[key]);

    if (inconsistentKeys.length > 0) {
      inconsistentFiles.push(file.name);
      console.log(
        chalk`├── {yellow.bold ${file.name} contains} {red.bold ${String(
          inconsistentKeys.length,
        )}} {yellow.bold inconsistent key(s)}`,
      );
    }
  }

  if (inconsistentFiles.length > 0) {
    console.log(
      chalk`└── {yellow.bold Found key-value inconsistencies in} {red.bold ${String(
        inconsistentFiles.length,
      )}} {yellow.bold file(s).}`,
    );

    console.log();

    if (fixInconsistencies) {
      console.log(`💚 Fixing inconsistencies...`);
      fixSourceInconsistencies(
        templateFilePath,
        evaluateFilePath(resolvedCacheDir, directoryStructure, sourceLanguage),
      );
      console.log(chalk`└── {green.bold Fixed all inconsistencies.}`);
    } else {
      console.log(
        chalk`Please either fix these inconsistencies manually or supply the {green.bold -f} flag to automatically fix them.`,
      );
    }
  } else {
    console.log(chalk`└── {green.bold No inconsistencies found}`);
  }
  console.log();

  console.log(`🔍 Looking for invalid keys in source files...`);
  const invalidFiles: string[] = [];

  for (const file of templateFiles.filter((f) => f.type === 'key-based')) {
    const invalidKeys = Object.keys(file.originalContent).filter(
      (k) => typeof (file.originalContent as any)[k] === 'string' && k.includes(' '),
    );

    if (invalidKeys.length > 0) {
      invalidFiles.push(file.name);
      console.log(
        chalk`├── {yellow.bold ${file.name} contains} {red.bold ${String(
          invalidKeys.length,
        )}} {yellow.bold invalid key(s)}`,
      );
    }
  }

  if (invalidFiles.length) {
    console.log(
      chalk`└── {yellow.bold Found invalid keys in} {red.bold ${String(
        invalidFiles.length,
      )}} {yellow.bold file(s).}`,
    );

    console.log();
    console.log(
      chalk`It looks like you're trying to use the key-based mode on natural-language-style JSON files.`,
    );
    console.log(
      chalk`Please make sure that your keys don't contain periods (.) or remove the {green.bold --type} / {green.bold -t} option.`,
    );
    console.log();
    process.exit(1);
  } else {
    console.log(chalk`└── {green.bold No invalid keys found}`);
  }
  console.log();

  let totalAddedTranslations = 0;
  let totalRemovedTranslations = 0;

  for (const language of targetLanguages) {
    if (!translationService.supportsLanguage(language)) {
      console.log(
        chalk`🙈 {yellow.bold ${translationService.name} doesn't support} {red.bold ${language}}{yellow.bold . Skipping this language.}`,
      );
      console.log();
      continue;
    }

    console.log(
      chalk`💬 Translating strings from {green.bold ${sourceLanguage}} to {green.bold ${language}}...`,
    );

    const translateContent = createTranslator(
      translationService,
      service,
      sourceLanguage,
      language,
      cacheDir,
      workingDir,
      directoryStructure,
      deleteUnusedStrings,
      withArrays,
      overwrite,
    );

    switch (directoryStructure) {
      case 'default':
        const existingFiles = loadTranslations(
          evaluateFilePath(workingDir, directoryStructure, language),
          exclude,
          type,
          withArrays,
        );

        if (deleteUnusedStrings) {
          const templateFileNames = templateFiles.map((t) => t.name);
          const deletableFiles = existingFiles.filter((f) => !templateFileNames.includes(f.name));

          for (const file of deletableFiles) {
            console.log(
              chalk`├── {red.bold ${file.name} is no longer used and will be deleted.}`,
            );

            fs.unlinkSync(
              path.resolve(
                evaluateFilePath(workingDir, directoryStructure, language),
                file.name,
              ),
            );

            const cacheFile = path.resolve(
              evaluateFilePath(workingDir, directoryStructure, language),
              file.name,
            );
            if (fs.existsSync(cacheFile)) {
              fs.unlinkSync(cacheFile);
            }
          }
        }

        for (const templateFile of templateFiles) {
          process.stdout.write(`├── Translating ${templateFile.name}`);

          const [addedTranslations, removedTranslations] = await translateContent(
            templateFile,
            existingFiles.find((f) => f.name === templateFile.name),
          );

          totalAddedTranslations += addedTranslations;
          totalRemovedTranslations += removedTranslations;
        }
        break;

      case 'ngx-translate':
        const sourceFile = templateFiles.find((f) => f.name === `${sourceLanguage}.json`);
        if (!sourceFile) {
          throw new Error('Could not find source file. This is a bug.');
        }
        const [addedTranslations, removedTranslations] = await translateContent(
          sourceFile,
          templateFiles.find((f) => f.name === `${language}.json`),
        );

        totalAddedTranslations += addedTranslations;
        totalRemovedTranslations += removedTranslations;
        break;
    }

    console.log(chalk`└── {green.bold All strings have been translated.}`);
    console.log();
  }

  if (service !== 'dry-run') {
    console.log('🗂 Caching source translation files...');
    await new Promise((res, rej) =>
      ncp(
        evaluateFilePath(workingDir, directoryStructure, sourceLanguage),
        evaluateFilePath(resolvedCacheDir, directoryStructure, sourceLanguage),
        (err) => (err ? rej(err) : res(null)),
      ),
    );
    console.log(chalk`└── {green.bold Translation files have been cached.}`);
    console.log();
  }

  console.log(chalk.green.bold(`${totalAddedTranslations} new translations have been added!`));

  if (totalRemovedTranslations > 0) {
    console.log(
      chalk.green.bold(`${totalRemovedTranslations} translations have been removed!`),
    );
  }
}
