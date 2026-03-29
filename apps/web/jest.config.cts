const nextJest = require('next/jest.js');
const path = require('path');

const createJestConfig = nextJest({
  dir: __dirname,
});

const config = {
  displayName: '@clipflow/web',
  preset: '../../jest.preset.js',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../coverage/apps/web',
  testEnvironment: 'jsdom',
};

const jestConfig = createJestConfig(config);

module.exports = async () => {
  const resolved = await jestConfig();
  resolved.moduleNameMapper = {
    ...resolved.moduleNameMapper,
    '^@/(.*)$': path.resolve(__dirname, 'src/$1'),
  };
  // Remove @/ paths from SWC transform config so moduleNameMapper handles them
  for (const val of Object.values(resolved.transform)) {
    const options = Array.isArray(val) ? val[1] : val;
    if (options?.jsConfig?.compilerOptions?.paths?.['@/*']) {
      delete options.jsConfig.compilerOptions.paths['@/*'];
    }
  }
  return resolved;
};
