#!/usr/bin/env node

import { Command } from 'commander';
import { add } from './commands/add';

const program = new Command();

// Define CLI metadata
program
  .name('next-svgl')
  .description('A CLI for adding SVGs to your Next.js project')
  .version('1.0.0');

// Add command
program
  .command('add [svgNames...]')
  .description(
    'Add SVG components to your project (optionally specify SVG names as arguments)'
  )
  .action((svgNames) => {
    add(svgNames);
  });

// Parse command-line arguments
program.parse(process.argv);
