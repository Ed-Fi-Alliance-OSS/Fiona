# SPDX-License-Identifier: Apache-2.0
# Licensed to the Ed-Fi Alliance under one or more agreements.
# The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

FROM mcr.microsoft.com/azure-functions/node:4-node20
WORKDIR /home/site/wwwroot

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY host.json ./
COPY WeeklyReportTrigger/ ./WeeklyReportTrigger/
COPY lib/ ./lib/
