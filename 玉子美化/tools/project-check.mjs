import process from 'node:process';
import { checkWorkflowProject, parseCliArgs, printCliResult, promptForMissing } from './project-lib.mjs';

const options = parseCliArgs(process.argv.slice(2), { boolean: ['release', 'json'] });
options.project ||= options._[0];
await promptForMissing(options, [{ key: 'project', label: 'project.json 路径' }]);
const mode = options.release ? 'release' : options.mode || 'draft';
const result = await checkWorkflowProject(options.project, { mode });
if (!result.ok) {
  console.error(result.errors.join('\n'));
  process.exitCode = 1;
} else {
  printCliResult({ ...result, message: `${mode === 'release' ? '发布' : '草稿'}检查通过：${options.project}` }, { json: options.json });
}
