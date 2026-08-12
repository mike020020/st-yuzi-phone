import process from 'node:process';
import { createProject, parseCliArgs, printCliResult, promptForMissing } from './project-lib.mjs';

const options = parseCliArgs(process.argv.slice(2), { boolean: ['dry-run', 'json'] });
await promptForMissing(options, [
  { key: 'id', label: '项目 id（小写字母、数字、点、下划线或连字符）' },
  { key: 'name', label: '项目显示名称' },
]);
const result = await createProject({
  projectsDir: options['projects-dir'] || 'projects',
  id: options.id,
  name: options.name,
  version: options.version || '1.0.0',
  author: options.author || '',
  dryRun: Boolean(options['dry-run']),
});
printCliResult({ ...result, message: `${result.dryRun ? '计划创建' : '已创建'}空白草稿：${result.projectDir}` }, { json: options.json });
