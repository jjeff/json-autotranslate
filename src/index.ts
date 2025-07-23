#!/usr/bin/env node

import chalk from 'chalk';
import commander from 'commander';

import { translate, listServices, listMatchers } from './translate';

require('dotenv').config();

commander
  .option('-i, --input <inputDir>', 'the directory containing language directories', '.')
  .option('--exclude <exclude glob>', 'exclude files matching the given glob pattern')
  .option('--cache <cacheDir>', 'set the cache directory', '.json-autotranslate-cache')
  .option('-l, --source-language <sourceLang>', 'specify the source language', 'en')
  .option('-t, --type <key-based|natural|auto>', `specify the file structure type`, /^(key-based|natural|auto)$/, 'auto')
  .option('-a, --with-arrays', `enables support for arrays in files, but removes support for keys named 0, 1, 2, etc.`)
  .option('-s, --service <service>', `selects the service to be used for translation`, 'google-translate')
  .option('-g, --glossaries [glossariesDir]', `set the glossaries folder to be used by DeepL. Keep empty for automatic determination of matching glossary`)
  .option('-a, --appName <appName>', `specify the name of your app to distinguish DeepL glossaries (if sharing an API key between multiple projects)`, 'json-autotranslate')
  .option('--context <context>', `set the context that is used by DeepL for translations, for OpenAI it's the path to a JSON file`)
  .option('--list-services', `outputs a list of available services`)
  .option('-m, --matcher <matcher>', `selects the matcher to be used for interpolations`, 'icu')
  .option('--list-matchers', `outputs a list of available matchers`)
  .option('-c, --config <value>', 'supply a config parameter (e.g. path to key file) to the translation service')
  .option('-f, --fix-inconsistencies', `automatically fixes inconsistent key-value pairs by setting the value to the key`)
  .option('-d, --delete-unused-strings', `deletes strings in translation files that don't exist in the template`)
  .option('--directory-structure <default|ngx-translate>', 'the locale directory structure')
  .option('--decode-escapes', 'decodes escaped HTML entities like &#39; into normal UTF-8 characters')
  .option('-o, --overwrite', 'overwrite existing translations instead of skipping them')
  .parse(process.argv);

if (commander.listServices) {
  console.log('Available services:');
  console.log(listServices().join(', '));
  process.exit(0);
}

if (commander.listMatchers) {
  console.log('Available matchers:');
  console.log(listMatchers().join(', '));
  process.exit(0);
}

translate({
  inputDir: commander.input,
  exclude: commander.exclude,
  cacheDir: commander.cache,
  sourceLanguage: commander.sourceLanguage,
  deleteUnusedStrings: commander.deleteUnusedStrings,
  type: commander.type,
  withArrays: commander.withArrays,
  directoryStructure: commander.directoryStructure,
  fixInconsistencies: commander.fixInconsistencies,
  service: commander.service,
  matcher: commander.matcher,
  decodeEscapes: commander.decodeEscapes,
  config: commander.config,
  glossariesDir: commander.glossaries,
  appName: commander.appName,
  context: commander.context,
  overwrite: commander.overwrite,
}).catch((e: Error) => {
  console.log();
  console.log(chalk.bgRed('An error has occurred:'));
  console.log(chalk.bgRed(e.message));
  console.log(chalk.bgRed(e.stack));
  console.log();
  process.exit(1);
});
