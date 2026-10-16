---
area: general
pattern: cli-flag-overrides-injected-env
severity: important
reviewer: test-hunter
source: "#409"
---

Before handing a job its credentials through environment variables, read how the job calls its tools: `backup.ts` always passes `aws --profile`, and an explicit profile makes the AWS CLI ignore key variables in the environment, so the injected key would never have been used. Give the tool what its actual command line reads (here a profile file), and test the wrapper against a stub of that tool.
