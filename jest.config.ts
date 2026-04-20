import type { Config } from "jest"

const config: Config = {
  verbose: true,
  testEnvironment: "jsdom",
  roots: ["<rootDir>/__tests__"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
          esModuleInterop: true,
          moduleResolution: "node",
          strict: false,
        },
      },
    ],
  },
  moduleNameMapper: {
    // Resolve the "@/*" path alias used across the project
    "^@/(.*)$": "<rootDir>/$1",
  },
  setupFiles: ["<rootDir>/jest.setup.ts"],
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  collectCoverageFrom: [
    "lib/**/*.ts",
    "app/api/**/*.ts",
    "utils/supabase/**/*.ts",
    "!**/*.d.ts",
  ],
}

export default config
