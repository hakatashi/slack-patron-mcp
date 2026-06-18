/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  setupFiles: ["./tests/setup.ts"],
  // Strip .js extensions so ts-jest resolves TypeScript source files correctly
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          rootDir: ".",
          esModuleInterop: true,
          isolatedModules: true,
          ignoreDeprecations: "6.0",
        },
      },
    ],
  },
};
