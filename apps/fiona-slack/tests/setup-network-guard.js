// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Citation link checking (AI-227) is on by default and uses the global fetch.
// Unit tests must never reach the network, so any test that does not install
// its own fetch mock gets one that rejects. The link checker treats a rejected
// fetch as "unknown" and keeps the source, so tests that don't care about link
// checking see today's behaviour.
globalThis.fetch = () => Promise.reject(new Error('Unexpected network call in a unit test; mock globalThis.fetch'));
