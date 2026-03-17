// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, beforeEach, afterEach, test, expect, jest } from '@jest/globals';

describe('app.js', () => {
	let originalLog;

	beforeEach(() => {
		originalLog = console.log;
		console.log = jest.fn();
		jest.resetModules();
	});

	afterEach(() => {
		console.log = originalLog;
	});

	test('logs hello world on load', () => {
		require('../src/app');
		expect(console.log).toHaveBeenCalledWith('hello world');
	});
});

