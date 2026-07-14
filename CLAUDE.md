When creating a new JavaScript file, always start with the following license header, or equivalent if the file is YAML or Dockerfile.

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.
```

## SME Candidate Selection

To select conversation candidates for SME evaluation cycles, use the `sme-candidate-selector` agent:

```
/agent sme-candidate-selector "Select 20 candidates for cycle 1, last 30 days"
```

See `.github/agents/sme-candidate-selector.agent.md` for full options and ground rules.
