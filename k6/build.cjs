const esbuild = require('esbuild');
const { readdirSync } = require('fs');
const path = require('path');

const scenarios = readdirSync(path.join(__dirname, 'scenarios'))
  .filter(f => f.endsWith('.ts'));

for (const scenario of scenarios) {
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, 'scenarios', scenario)],
    outfile: path.join(__dirname, 'dist', scenario.replace('.ts', '.js')),
    bundle: true,
    format: 'esm',
    target: 'es2020',
    external: ['k6', 'k6/*'],  // k6 modules are provided by the runtime
    platform: 'neutral',
  });
  console.log(`Built: ${scenario} → dist/${scenario.replace('.ts', '.js')}`);
}
