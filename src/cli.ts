#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import {
  approveCommand,
  clarifyCommand,
  intakeCommand,
  publishCommand,
  specCommand,
  ticketsCommand,
  triageCommand,
} from './commands/flow.js';
import {
  implementCommand,
  prCommand,
  reviewCommand,
} from './commands/deliver-one.js';
import {
  acceptCommand,
  retroCommand,
  runCommand,
  statusCommand,
  traceCommand,
} from './commands/deliver.js';
import { doctorCommand } from './commands/doctor.js';
import { Logger } from './core/logger.js';
import { isHandrailError } from './core/errors.js';
import type { AgentProvider } from './types.js';

const program = new Command();

program
  .name('handrail')
  .description('Human-gated, evidence-backed AI delivery on GitHub')
  .version('0.1.0')
  .option('-C, --cwd <dir>', 'working directory', process.cwd())
  .option('-v, --verbose', 'show detailed output')
  .option('--json', 'print machine-readable JSON where supported')
  .addHelpText(
    'after',
    `
Workflow:
  handrail init
  handrail intake --prd PRD.md
  handrail triage <issue> --apply
  handrail clarify --interactive --comment --write-docs
  handrail spec
  handrail approve spec <spec>
  handrail tickets <spec>
  handrail approve tickets <spec>
  handrail publish tickets <spec>
  handrail implement <ticket>
  handrail review <ticket>
  handrail pr <ticket> --create
  handrail accept <spec>
  handrail retro <spec>

Handrail never merges a pull request and never bypasses branch protection.
A human must approve specs, ticket splits and pull requests.
`,
  );

program
  .command('init [dir]')
  .description('Scaffold Handrail workflow files in a repository')
  .option('--force', 'overwrite existing scaffold files')
  .option('--dry-run', 'show what would be written without writing')
  .option('--agent <provider>', 'agent provider: anthropic | command | mock', 'anthropic')
  .option('--base <branch>', 'base branch', 'main')
  .option('--name <name>', 'project name')
  .option('--github', 'create the workflow labels with gh')
  .action(async (dir: string | undefined, options) => {
    await guard(async () => {
      const global = program.opts();
      await initCommand(
        dir ?? global.cwd,
        {
          force: options.force,
          dryRun: options.dryRun,
          agent: options.agent as AgentProvider,
          base: options.base,
          name: options.name,
          github: options.github,
        },
        new Logger({ verbose: global.verbose, json: global.json }),
      );
    });
  });

program
  .command('intake')
  .description('Create a requirement issue from a PRD')
  .requiredOption('-p, --prd <file>', 'path to the product requirement document')
  .option('-t, --title <title>', 'requirement title')
  .option('--source <source>', 'source label or URL recorded in the issue')
  .option('--dry-run', 'draft the issue body without creating it')
  .action(async (options) => {
    await guard(async () => {
      const global = program.opts();
      await intakeCommand({
        cwd: global.cwd,
        verbose: global.verbose,
        prd: options.prd,
        title: options.title,
        source: options.source,
        dryRun: options.dryRun,
      });
    });
  });

program
  .command('triage <issue>')
  .description('Investigate an incoming issue and draft a triage decision')
  .option('--apply', 'post findings and update the triage label')
  .action(async (issue: string, options) => {
    await guard(async () => {
      const global = program.opts();
      await triageCommand({ cwd: global.cwd, verbose: global.verbose, issue, apply: options.apply });
    });
  });

program
  .command('clarify [issue]')
  .description('Clarify a requirement and record decisions, assumptions and open questions')
  .option('-i, --interactive', 'ask one question at a time and record the answers')
  .option('--rounds <number>', 'maximum clarification rounds')
  .option('--comment', 'post the clarification summary to the issue')
  .option('--write-docs', 'add confirmed glossary terms and proposed ADRs to the repository')
  .action(async (issue: string | undefined, options) => {
    await guard(async () => {
      const global = program.opts();
      await clarifyCommand({
        cwd: global.cwd,
        verbose: global.verbose,
        issue,
        interactive: options.interactive,
        rounds: options.rounds,
        comment: options.comment,
        writeDocs: options.writeDocs,
      });
    });
  });

program
  .command('spec [requirement]')
  .description('Create a spec issue from a clarified requirement')
  .action(async (requirement: string | undefined) => {
    await guard(async () => {
      const global = program.opts();
      await specCommand({
        cwd: global.cwd,
        verbose: global.verbose,
        requirement,
      });
    });
  });

program
  .command('approve <kind> <number>')
  .description('Record a human approval: approve spec <issue> or approve tickets <spec>')
  .action(async (kind: string, number: string) => {
    await guard(async () => {
      const global = program.opts();
      await approveCommand({ cwd: global.cwd, verbose: global.verbose, kind, number });
    });
  });

program
  .command('tickets [spec]')
  .description('Draft implementation tickets from an approved spec')
  .action(async (spec: string | undefined) => {
    await guard(async () => {
      const global = program.opts();
      await ticketsCommand({ cwd: global.cwd, verbose: global.verbose, spec });
    });
  });

program
  .command('publish <kind> [number]')
  .description('Publish approved tickets: publish tickets <spec>')
  .action(async (kind: string, number: string | undefined) => {
    await guard(async () => {
      const global = program.opts();
      await publishCommand({ cwd: global.cwd, verbose: global.verbose, kind, number });
    });
  });

program
  .command('implement <ticket>')
  .description('Implement one approved ticket on its branch')
  .option('--skip-review', 'skip the independent review step')
  .option('--skip-checks', 'do not run configured checks')
  .option('--allow-no-checks', 'allow a project with no configured checks')
  .action(async (ticket: string, options) => {
    await guard(async () => {
      const global = program.opts();
      await implementCommand({
        cwd: global.cwd,
        verbose: global.verbose,
        ticket,
        skipReview: options.skipReview,
        skipChecks: options.skipChecks,
        allowNoChecks: options.allowNoChecks,
      });
    });
  });

program
  .command('review <ticket>')
  .description('Review the current ticket branch against the base branch')
  .action(async (ticket: string) => {
    await guard(async () => {
      const global = program.opts();
      await reviewCommand({ cwd: global.cwd, verbose: global.verbose, ticket });
    });
  });

program
  .command('pr <ticket>')
  .description('Prepare or create a traceable pull request for a ticket')
  .option('--create', 'push the branch and create the pull request')
  .option('--ready', 'create a ready-for-review PR instead of a draft')
  .option('--skip-review', 'do not require a recorded review')
  .action(async (ticket: string, options) => {
    await guard(async () => {
      const global = program.opts();
      await prCommand({
        cwd: global.cwd,
        verbose: global.verbose,
        ticket,
        create: options.create,
        ready: options.ready,
        skipReview: options.skipReview,
      });
    });
  });

program
  .command('accept [spec]')
  .description('Run final acceptance for a spec')
  .option('--close', 'close the spec and requirement after a passing acceptance')
  .option('--allow-no-ci', 'allow acceptance when a PR has no CI checks')
  .action(async (spec: string | undefined, options) => {
    await guard(async () => {
      const global = program.opts();
      await acceptCommand({
        cwd: global.cwd,
        verbose: global.verbose,
        spec,
        close: options.close,
        allowNoCI: options.allowNoCi,
      });
    });
  });

program
  .command('retro [spec]')
  .description('Generate a retrospective for a spec')
  .option('--publish', 'post the retrospective to the requirement issue')
  .action(async (spec: string | undefined, options) => {
    await guard(async () => {
      const global = program.opts();
      await retroCommand({
        cwd: global.cwd,
        verbose: global.verbose,
        spec,
        publish: options.publish,
      });
    });
  });

program
  .command('status [spec]')
  .description('Show the traceability chain and gate status')
  .action(async (spec: string | undefined) => {
    await guard(async () => {
      const global = program.opts();
      await statusCommand({ cwd: global.cwd, verbose: global.verbose, json: global.json, spec });
    });
  });

program
  .command('trace [requirement]')
  .description('Print the requirement -> spec -> tickets -> PR chain')
  .action(async (requirement: string | undefined) => {
    await guard(async () => {
      const global = program.opts();
      await traceCommand({
        cwd: global.cwd,
        verbose: global.verbose,
        json: global.json,
        requirement,
      });
    });
  });

program
  .command('run [spec]')
  .description('Implement open tickets in dependency order, stopping at the human merge gate')
  .option('--max-tickets <number>', 'maximum tickets to process in this run')
  .option('--watch', 'wait for each PR to be merged before continuing')
  .option('--watch-timeout <minutes>', 'watch timeout in minutes', '30')
  .option('--skip-review', 'skip the independent review step')
  .option('--allow-no-checks', 'allow a project with no configured checks')
  .action(async (spec: string | undefined, options) => {
    await guard(async () => {
      const global = program.opts();
      await runCommand({
        cwd: global.cwd,
        verbose: global.verbose,
        spec,
        maxTickets: options.maxTickets,
        watch: options.watch,
        watchTimeout: options.watchTimeout,
        skipReview: options.skipReview,
        allowNoChecks: options.allowNoChecks,
      });
    });
  });

program
  .command('doctor')
  .description('Check git, GitHub CLI, labels, checks and agent credentials')
  .action(async () => {
    await guard(async () => {
      const global = program.opts();
      const ok = await doctorCommand({ cwd: global.cwd, verbose: global.verbose });
      if (!ok) process.exitCode = 1;
    });
  });

program.showHelpAfterError('(run "handrail --help" for usage)');
program.parseAsync(process.argv);

async function guard(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const global = program.opts();
    if (global.json) {
      console.error(
        JSON.stringify(
          {
            error: error instanceof Error ? error.message : String(error),
            code: isHandrailError(error) ? error.code : 'UNKNOWN',
            hint: isHandrailError(error) ? error.hint : undefined,
          },
          null,
          2,
        ),
      );
    } else {
      console.error(`\nERROR ${error instanceof Error ? error.message : String(error)}`);
      if (isHandrailError(error) && error.hint) {
        console.error(`HINT  ${error.hint}`);
      }
      if (global.verbose && error instanceof Error && error.stack) {
        console.error(error.stack);
      }
    }
    process.exitCode = 1;
  }
}
