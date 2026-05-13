# Ed-Fi Concept Semantic Scan Results

Scanned: `c:\Dev\local-ed-fi\ed-fi-alliance-oss.github.io` (*.md, *.mdx)
Date: 2026-05-11 | Revised: 2026-05-12 (user corrections applied)

Legend: 🟢 Strong evidence | 🟡 Moderate evidence | 🔴 Weak / not found

> **Corrections applied from user review:**
> - *System Implementor* renamed to **System Integrator** (canonical term in docs)
> - *Data Store Instance* updated with emerging aliases: `odsInstance` / `dmsInstance`
> - *Admin App* split into two concepts: **Admin App v4** (current) and **ODS Admin App v3** (legacy)
> - *Admin API* now includes full version history and ODS/API compatibility matrix

---

## 1. Ed-Fi Product 🟢
**Best sources:**
- `docs/reference/0-roadmap/advisories/log4j.md`
- `docs/getting-started/provider-playbook/project-planning/technology-provider-ed-fi-journey.md`

**Draft definition:**
A software product or technology component that is part of the Ed-Fi Technology Suite or product portfolio, maintained by the Ed-Fi Alliance. Includes reference implementations such as the ODS/API, Admin API, Admin App, and Data Import, as well as community-contributed tools. Products have defined lifecycle support windows.

---

## 2. Ed-Fi Community 🟢
**Best sources:**
- `docs/partners/2-certification/` (multiple)
- `docs/reference/1-data-exchange/extensions-framework/readme.md`

**Draft definition:**
The collective network of education agencies, technology providers, managed service providers, system integrators, and other stakeholders who adopt, contribute to, and govern the Ed-Fi Data Standard and Technology Suite. The community engages through the Ed-Fi Community Hub (community.ed-fi.org) and participates in governance, feedback, and collaborative development.

---

## 3. Educator Pipeline 🟢
**Best sources:**
- `docs/reference/10-educator-pipeline/readme.md`
- `docs/getting-started/educator-pipeline/overview.md`

**Draft definition:**
The end-to-end journey of an educator from early interest through teacher preparation program enrollment, certification, hiring, and career growth. The Ed-Fi ecosystem supports this pipeline via the Educator Preparation Data Model (EPDM), dashboards, and related use cases to help stakeholders reduce attrition and ensure qualified staffing.

---

## 4. Technology Roadmap 🟢
**Best sources:**
- `docs/reference/0-roadmap/readme.mdx`
- `blog/2024-12-18.md`, `blog/2025-10-09.md`

**Draft definition:**
The public Ed-Fi Technology Roadmap hosted on GitHub (github.com/orgs/Ed-Fi-Alliance-OSS/projects/1) that communicates upcoming features, deprecations, and priorities for the Ed-Fi Technology Suite. Community members can view roadmap boards and file issues to influence future development.

---

## 5. Data Store Instance 🟡 *(emerging concept)*
**Best sources:**
- `odsApi_versioned_docs/version-7.3/platform-dev-guide/configuration/single-and-multi-tenant-configuration.md` (as `odsInstance`)
- *(ODS/API v8 / DMS docs — not yet published in this repo)* (as `dmsInstance`)

**Aliases:**
| Alias | Context |
|---|---|
| `odsInstance` | ODS/API pre-v8 — a provisioned SQL database entry registered in the `EdFi_Admin` database |
| `dmsInstance` | ODS/API v8 (Data Management Service) — the equivalent concept in the next-generation platform |

**Draft definition:**
An emerging concept representing a specific provisioned instance of an Ed-Fi data store — either a SQL-backed ODS database (pre-v8) or a DMS data store (v8+) — associated with a tenant or education organization context in a single- or multi-tenant deployment. Each instance has its own connection string, context key, and may be scoped by school year, district, or LEA.

> ℹ️ This term does not yet appear in published documentation. It is being introduced as a cross-version abstraction to unify the `odsInstance` (ODS/API ≤ v7.x) and `dmsInstance` (ODS/API v8) concepts under a single graph node type.

---

## 6. Ed-Fi API Specification 🟢
**Best sources:**
- `docs/reference/1-data-exchange/api-guidelines/design-and-implementation-guidelines/scope.md`
- `docs/reference/1-data-exchange/api-guidelines/design-and-implementation-guidelines/api-design-guidelines/discovery-api.md`
- `docs/reference/1-data-exchange/api-guidelines/design-and-implementation-guidelines/api-design-guidelines/ed-fi-descriptors.md`
- `odsApi_versioned_docs/*/platform-dev-guide/documentation-client-support.md`

**Ed-Fi API Specifications enumerated:**
| Specification | Role | Conformance Level |
|---|---|---|
| **Resource API** | Core data exchange — CRUD operations on UDM entities (students, courses, assessments, etc.) | Required for Ed-Fi alignment / Ed-Fi compatible |
| **Discovery API** | Metadata endpoint — returns software version, UDM version, auth URLs, and available specs | Required for Ed-Fi compatible |
| **Descriptors API** | Enumeration management — CRUD for coded value sets (grade levels, race, subjects, etc.) | Required alongside Resource API |
| **Admin API** | Programmatic platform administration — vendors, clients, claim sets, ODS instances, tenants | Required for platform hosts; separate product (v1.x/v2.x) |
| **Identity API** | Person identity resolution — lookup and disambiguation of student/staff identities | Optional |
| **Change Queries API** | Incremental data sync — returns resources changed since a given token/timestamp | Optional; enables efficient replication |
| **Enrollment API** | Lightweight enrollment data push — simplified onboarding workflow for SIS providers | Deprecated (per `notifications/enrollment-api-deprecation.md`) |
| **OAuth 2.0** | Authentication — client credentials grant for API access | Required by all Ed-Fi APIs |
| **Management API** *(DMS era)* | Next-generation platform administration in the DMS Platform — successor to Admin API | Roadmap / emerging |
| *Resource API Profiles* | Constrained subsets of the Resource API scoped to specific use cases | Optional; defined per deployment |

**Ed-Fi alignment tiers (from scope.md):**
- **Ed-Fi aligned** — implements *some* subset of the Resource API following the guidelines
- **Ed-Fi compatible** — implements the *entire* Resource API **plus** the Discovery API

**Draft definition:**
A formal document published by the Ed-Fi Alliance that defines the resources, HTTP verbs, URL patterns, request/response schemas, and behavioral constraints that an Ed-Fi-compatible REST API must implement. The Ed-Fi Alliance produces multiple distinct API specifications (Resource, Discovery, Descriptors, Admin, Identity, Change Queries, etc.) that together define the complete Ed-Fi API surface. Implementations select which specifications to support based on their conformance tier and use case. All specifications are OpenAPI 3-described and GitHub-hosted at `Ed-Fi-Alliance-OSS/Ed-Fi-API-Standards`.

---

## 7. Ed-Fi Tenant 🟢
**Best sources:**
- `odsApi_versioned_docs/version-7.3/platform-dev-guide/configuration/single-and-multi-tenant-configuration.md`

**Draft definition:**
A logical partition in a multi-tenant Ed-Fi ODS/API deployment. Each tenant has its own `EdFi_Admin` and `EdFi_Security` databases and a unique identifier segment in API URLs. Multi-tenancy was introduced in ODS/API v7.0 to support managed service providers and collaboratives hosting data for multiple districts.

---

## 8. Ed-Fi Deployment 🟢
**Best sources:**
- `odsApi_versioned_docs/*/platform-dev-guide/deployment/`
- `odsApi_versioned_docs/version-7.3/technical-articles/guidance-on-multi-year-data-in-ods.md`

**Draft definition:**
A running installation of one or more Ed-Fi Technology Suite components (ODS/API, Admin API, Admin App, etc.) in a production, sandbox, or development environment. Deployment modes include single-tenant, multi-tenant, year-specific, and district-specific configurations, and may run on-premises, in Docker containers, or on cloud platforms (Azure, AWS).

---

## 9. Ed-Fi Vendor 🟢
**Best sources:**
- `odsApi_versioned_docs/version-7.3/platform-dev-guide/security/security-configuration-data-stores.md`
- `odsApi_versioned_docs/version-7.3/platform-dev-guide/security/readme.md`

**Draft definition:**
An organization (typically a software company) that hosts or owns client systems that integrate with the Ed-Fi ODS/API. Vendors are registered in the `EdFi_Admin` database with associated namespace prefixes, users, and applications. Vendors may hold Ed-Fi Certifications or Badges demonstrating interoperability compliance.

---

## 10. Ed-Fi Partner 🟢
**Best sources:**
- `docs/partners/2-certification/certification-for-data-providers/partner-program.md`
- `docs/getting-started/provider-playbook/specifics-by-provider-type/`

**Draft definition:**
An organization that has formally joined the Ed-Fi Partner Program, enabling them to pursue Ed-Fi Certifications and Badges. Partners include technology providers (SIS vendors, assessment vendors), managed service providers, and implementation partners. Partnership is a prerequisite for certification.

---

## 11. Ed-Fi Certification 🟢
**Best sources:**
- `docs/partners/2-certification/` (extensive)
- `docs/getting-started/provider-playbook/support/ed-fi-credentialing.md`

**Draft definition:**
A formal credential issued by the Ed-Fi Alliance that verifies a product has been tested against defined API endpoint requirements and data quality standards. Certifications (e.g., SIS Certification v4/v5, Domain API Certification) remain active for one year and require renewal. Certification is distinct from Badging and requires a higher level of implementation verification.

---

## 12. Ed-Fi Badge 🟢
**Best sources:**
- `docs/partners/1-badging/` (extensive)
- `docs/getting-started/provider-playbook/support/ed-fi-badge-program.md`

**Draft definition:**
A credential awarded by the Ed-Fi Alliance that allows product developers to demonstrate support for the Ed-Fi Data Standard or Technology Suite in areas not yet covered by formal Certification. Badges (e.g., API Consumer Badge, Managed Service Provider Badge, Implementation Partner Badge) remain active for two years. A registry of badged products is published at docs.ed-fi.org/partners/badging.

---

## 13. Ed-Fi Playbook 🟢
**Best sources:**
- `docs/getting-started/sea-playbook/readme.md`
- `docs/getting-started/provider-playbook/readme.md`
- `docs/getting-started/esa-playbook/readme.md`

**Draft definition:**
A structured guidance document published by the Ed-Fi Alliance for specific stakeholder audiences (State Education Agencies, Technology Providers, Education Service Agencies) that explains how to plan, implement, and sustain an Ed-Fi integration. Playbooks are available in PDF and PowerPoint formats and are intended to be adapted by organizations for their own teams.

---

## 14. Ed-Fi Exchange 🟢
**Best sources:**
- `docs/getting-started/edfi-exchange/readme.mdx`
- `odsApi_versioned_docs/*/platform-dev-guide/fundamentals.md`

**Draft definition:**
A technology hub (exchange.ed-fi.org / github.com/Ed-Fi-Exchange-OSS) for community contributions aligned to the Ed-Fi Data Standard and Technology Suite. States, districts, technology providers, and the Ed-Fi Alliance contribute solutions including extensions, deployment scripts, analytics tools, and technical white papers. Products transitioning out of core Alliance support (e.g., Analytics Middle Tier, Data Import) may move to the Exchange for community maintenance.

---

## 15. Ed-Fi Data Standard 🟢
**Best sources:**
- `docs/reference/1-data-exchange/readme.md`
- `dataStandard_versioned_docs/` (v3, v4, v5, v6)
- `odsApi_versioned_docs/version-7.3/whats-new/whats-new-in-prev-v7x-releases.md`

**Version history, domain additions, and ODS/API compatibility:**
| DS Version | Full Version | Status | Key Domain / Model Additions | Compatible ODS/API |
|---|---|---|---|---|
| v3 | v3.3.1-b | Legacy (EOL SY 2024–25) | Educator Preparation (EPP/EPDM) domains; early childhood data elements | v5.4, v6.1 |
| v4 | v4.0 | Active | SIS-aligned domains (Assessment, Enrollment, Finance); major UDM restructuring | v6.2, v7.0, v7.1, v7.3 |
| v5 | v5.2 *(latest minor)* | Active | Expanded SIS/assessment coverage; Cohort, CCMR use-case alignment | v6.2, v7.0, v7.1, v7.2, v7.3 |
| v6 | v6.0 | **Current (2025)** | Breaking changes to core entities; new domain additions; removes deprecated elements from v5 | v7.3+ |

**Version line summary:** v3 is end-of-life; v4 and v5 are still actively supported via ODS/API v7.3 multi-DS support; v6.0 is the current standard and requires ODS/API v7.3 or later.

**Draft definition:**
The Ed-Fi Data Standard is a set of data definitions, API specifications, and design guidelines that define a common language for K-12 education data exchange. It includes the Unifying Data Model (UDM), API Design & Implementation Guidelines, and the Data Handbook. Organizations must implement the Data Standard to achieve Ed-Fi alignment and interoperability. It is versioned independently from the ODS/API platform, with a single ODS/API version able to support multiple Data Standard versions simultaneously.

> ℹ️ **Concept #16 (Data Standard Version) is merged into this entry** — individual versions are best modeled as `(:DataStandardVersion)` nodes, not as a separate `:Concept` (see graph model analysis below).

---

## 16. Ed-Fi Data Model & UDM 🟢
*(formerly #17 — #16 merged into #15)*

**Best sources:**
- `docs/reference/1-data-exchange/udm/` (full section)
- `docs/reference/1-data-exchange/udm/getting-started/core-concepts.md`
- `odsApi_versioned_docs/*/platform-dev-guide/fundamentals.md`
- `docs/reference/1-data-exchange/technical-articles/understanding-uml-rest-api-and-database-expressions-of-the-ed-fi-data-model.md`

**Draft definition:**
The structured representation of K-12 education entities and their relationships as defined by the Ed-Fi Data Standard. The **Unifying Data Model (UDM)** is the semantic framework expressed as UML class diagrams. It covers domains such as Student, Staff, Assessment, Enrollment, Finance, and Educator Preparation. The UDM is the single source of truth from which MetaEd generates concrete artifacts: the ODS database schema, REST API resources, and XSD interchange schemas. It is versioned alongside the Data Standard and extensible via the Ed-Fi Extensions Framework.

**Three expressions of the same model:**
| Expression | Format | Generated by |
|---|---|---|
| UML / UDM | Class diagrams (conceptual) | Ed-Fi Alliance (authored in MetaEd) |
| REST API resources | OpenAPI / Swagger | MetaEd artifact generation |
| ODS database schema | SQL Server / PostgreSQL DDL | MetaEd artifact generation |
| XSD interchange | XML Schema | MetaEd artifact generation |

---

### 📐 Graph Model Design Analysis — Data Standard & Versioning

Three approaches were evaluated for representing the Data Standard and its versions in the Memgraph LPG:

#### Option A — Version as a property on the Concept node ❌
```cypher
// Single node, version embedded as a list property
(:Concept {name: "Ed-Fi Data Standard", versions: ["3.3", "4.0", "5.2", "6.0"]})
```
**Verdict:** Too lossy. Cannot traverse relationships per version (e.g., "which ODS/API versions support DS v5.2?").

#### Option B — Separate `:Concept` node per version ❌
```cypher
(:Concept {name: "Data Standard v6.0", status: "current"})
(:Concept {name: "Data Standard v5.2"})
// ...4 separate Concept nodes
```
**Verdict:** Pollutes the `:Concept` label with version nodes. Makes "tell me about the Data Standard" queries ambiguous and hard to root.

#### Option C — Hybrid: Root `:Concept` + `(:DataStandardVersion)` nodes ✅ *Recommended*
```cypher
// Root concept node — answers "what IS the Data Standard?"
(:Concept {name: "Ed-Fi Data Standard"})
  -[:HAS_VERSION {isCurrent: true}]->
(:DataStandardVersion {version: "6.0", status: "current", releaseYear: 2025, docsPath: "dataStandard_versioned_docs/version-6"})

// Version ↔ ODS/API cross-links — enables compatibility queries
(:DataStandardVersion {version: "6.0"})
  -[:IMPLEMENTED_BY]->
(:OdsApiVersion {version: "7.3", status: "current"})

// Data Model is expressed as an artifact of each version
(:DataStandardVersion {version: "6.0"})
  -[:EXPRESSED_AS]->
(:Concept {name: "Unifying Data Model (UDM)"})

// MetaEd generates from UDM
(:Concept {name: "MetaEd"})
  -[:GENERATES]->
(:Concept {name: "Unifying Data Model (UDM)"})
```

**Why Option C wins:**
- The root `:Concept` node is the stable anchor for questions and embeddings about "what is the Data Standard"
- `(:DataStandardVersion)` as a **separate label** (not `:Concept`) keeps the concept graph clean while enabling typed traversal
- `[:IMPLEMENTED_BY]` edges connect DS versions to ODS/API versions, making the compatibility matrix **queryable** (e.g., `MATCH (v:DataStandardVersion)<-[:HAS_VERSION]-(ds)-[:IMPLEMENTED_BY]->(api) RETURN v, api`)
- `[:EXPRESSED_AS]` edge models the fact that the UDM is a concrete artifact of each version — supporting questions like "what model underlies DS v5?"
- Consistent with how `(:DataStandardVersion)` and `(:OdsApiVersion)` can cross-link via the compatibility matrix already defined in entry #19

---

## 18. Ed-Fi Data Handbook 🟢
**Best sources:**
- `docs/reference/1-data-exchange/udm/getting-started/core-concepts.md`
- `dataStandard_versioned_docs/version-6/readme.md`

**Draft definition:**
A versioned reference document that accompanies the Ed-Fi Unifying Data Model, providing human-readable definitions of all entities, attributes, keys, and relationships in the Data Standard. Each Data Standard version has its own Data Handbook (e.g., DS v6.0 handbook at edfidocs.blob.core.windows.net). The MetaEd IDE also generates a Data Handbook for extension projects combining core and custom entities.

---

## 19. ODS/API Platform 🟢
**Best sources:**
- `odsApi_versioned_docs/` (entire versioned section)
- `docs/reference/1-data-exchange/tutorial.md`
- `odsApi_versioned_docs/*/whats-new/` (per-version release notes)

**Version history and Data Standard compatibility:**
| ODS/API Version | Data Standard | Status | Key Additions |
|---|---|---|---|
| v5.4 | DS v3.3 | Legacy (unmaintained) | Suite 3 baseline; SQL Server + PostgreSQL |
| v6.1 | DS v3.3–v4.0 | Legacy | Change queries (CQE); security enhancements |
| v6.2 | DS v4.0–v5.0 | Active | Supported alongside v7.x |
| v7.0 | DS v4.0–v5.0 | Unmaintained | Multi-tenancy introduced; ODS instance management |
| v7.1 | DS v4.0–v5.1 | Active | Admin API v2.1 alignment; multi-tenant refinements |
| v7.2 | DS v5.x | Unmaintained | Minor release; not recommended for new deployments |
| v7.3 | DS v4.0, v5.2, v6.0 | **Current** | Multi-Data Standard support; Docker; .NET 8 |
| v8.x (DMS) | DS v5.x–v6.x | *Roadmap* | Successor platform — Data Management Service; replaces relational ODS |

**Version line summary:** v5.4 is legacy; v6.2 and v7.1 are the two active supported versions; v7.3 is current default. v8.x (DMS) is the strategic successor, currently in roadmap/pre-release.

**Draft definition:**
The Ed-Fi Operational Data Store and API (ODS/API) is the Ed-Fi Alliance's reference implementation of the Ed-Fi API Specifications. It is a .NET-based REST API backed by SQL Server or PostgreSQL that provides secure, standards-aligned access to K-12 education data. It supports multi-tenancy, year-specific and district-specific ODS configurations, API Profiles, claim set-based authorization, and OpenAPI metadata. The platform is generated from MetaEd artifacts and is extensible via the Ed-Fi Extensions Framework.

> ℹ️ ODS/API Version is modeled as a relationship property (`:HAS_VERSION`) on the ODS/API concept node rather than as separate concept nodes, consistent with Data Standard Version treatment.

---

## 21. Admin API 🟢
**Best sources:**
- `docs/reference/3-admin-api/whats-new.md`
- `docs/reference/3-admin-api/getting-started/`
- `odsApi_versioned_docs/*/getting-started/binary-installation/singlemulti-tenant-installation-steps.*`

**Version history and ODS/API compatibility:**
| Admin API Version | Compatible ODS/API | Key Additions |
|---|---|---|
| v1.0 | ODS/API v3.x–v5.x | Initial release; vendor/application/key management |
| v1.1 | ODS/API v3.4–v5.3 | Claim set import/export; Docker support |
| v1.2 | ODS/API v6.0–v6.1 | Security model update support |
| v1.3 | ODS/API v5.x–v6.x | Separated from Admin App codebase; profiles management |
| v1.4 | ODS/API v6.x | .NET 8 upgrade |
| v2.0 | ODS/API v7.0 only | Multi-tenancy; OdsInstanceDerivatives; workflow-based setup |
| v2.1 | ODS/API v7.1 | Multi-tenant management; API restructure |
| v2.2 | ODS/API v6.x + v7.x | .NET 8; dual-version compatibility |
| v2.3 (latest) | ODS/API v6.x + v7.x | Docker ARM; latest release |

**Version line summary:** v1.x targets ODS/API Suite 3 (v5.x/v6.x); v2.x targets ODS/API v7.x with backward compatibility for v6.x from v2.2 onward.

**Draft definition:**
A RESTful administrative API (released separately from the ODS/API) that provides programmatic management of API clients, vendors, applications, claim sets, ODS instances, and tenants. Originally derived from the Admin App codebase (v1.3 separated them). Admin API v2.x replaced reliance on the Admin App UI for automation use cases and introduced full multi-tenancy support. Secured with OAuth (client credentials). The web UI counterpart is **Admin App v4**.

---

## 22. Admin App v4 *(current generation)* 🟢
**Best sources:**
- `docs/reference/admin-app/` ← **current generation docs**
- `docs/reference/admin-app/system-administrators/installing.md`

**Draft definition:**
The current-generation web-based administrative UI for managing multi-tenant, multi-environment Ed-Fi ODS/API deployments. Admin App v4 is built on top of Admin API v2.x and replaces both the legacy ODS Admin App (v3) and the Sandbox Admin App. It supports multi-tenant configuration, delegated administration, and manages vendors, API clients, claim sets, and ODS instances. Primary audiences: IT staff, Managed Service Providers, state agencies, and data hubs.

---

## 23. ODS Admin App *(legacy, v3)* 🟢
**Best sources:**
- `docs/reference/ods-admin-app/` ← **legacy docs**
- `docs/reference/ods-admin-app/whats-new.md`
- `odsApi_versioned_docs/version-5.4/platform-dev-guide/utilities/ods-api-admin-app.md`

**Draft definition:**
The legacy generation of the Ed-Fi administrative web UI, compatible with ODS/API Suite 3 (v5.x/v6.x). Also referred to as the ODS Admin App or Admin App v3. It provided graphical management of API keys/secrets, claim sets, ODS instances, and profiles. As of 2026 it is being sunset; new deployments should use Admin App v4. It was distinct from the Sandbox Admin App (development-only tool). The transition from ODS Admin App → Admin App v4 mirrors the Admin API v1.x → v2.x evolution.

**Version history (ODS Admin App):**
| Version | Compatible ODS/API | Notes |
|---|---|---|
| v1.x–v2.x | ODS/API Suite 2 | Legacy/unsupported |
| v2.2 | ODS/API v5.x | Cloud ODS support |
| v2.3 | ODS/API v6.x | Multi-instance connections, claim set management |

---

## 24. Data Import Tool 🟢
**Best sources:**
- `docs/reference/6-data-import/readme.md`
- `docs/reference/6-data-import/whats-new-in-data-import.md`

**Draft definition:**
An Ed-Fi tool that enables bulk loading of CSV data into the Ed-Fi ODS/API without requiring custom API integrations. Data Import uses configurable templates (shareable via the Ed-Fi Exchange) to map CSV columns to Ed-Fi API resources. Data Import v2.4 is the last planned Alliance-maintained release; it is transitioning to the Ed-Fi Exchange in 2026.

---

## 25. Education Organization 🟢
**Best sources:**
- `odsApi_versioned_docs/version-7.3/platform-dev-guide/security/security-configuration-data-stores.md`
- `dataStandard_versioned_docs/*/model-reference/education-organization-domain/`

**Draft definition:**
An abstract entity in the Ed-Fi Data Model representing any organization involved in K-12 education. Concrete subtypes include State Education Agency (SEA), Local Education Agency (LEA), Education Service Agency (ESA), and School. The education organization hierarchy is used extensively in the ODS/API authorization model to control data access based on organizational relationships.

---

## 26. SEA (State Education Agency) 🟢
**Best sources:**
- `docs/getting-started/sea-playbook/readme.md`
- `docs/reference/1-data-exchange/technical-articles/descriptor-guidance.md`

**Draft definition:**
A state-level government body responsible for K-12 education policy, data collection, and reporting (e.g., a State Department of Education). In the Ed-Fi ecosystem, SEAs are primary implementers of the ODS/API for statewide data collection and often mandate Ed-Fi Certification in vendor RFPs. SEAs may deploy Ed-Fi directly or through a Managed Service Provider.

---

## 27. LEA (Local Education Agency) 🟢
**Best sources:**
- `docs/community/involved/dictionary.md`
- `odsApi_versioned_docs/*/client-developers-guide/authorization.md`

**Draft definition:**
A school district or similar local government body responsible for providing public K-12 education within a geographic area. In the Ed-Fi data model, LEAs are a concrete subtype of Education Organization. API clients (e.g., SIS vendors) are typically associated with specific LEAs to scope their data access. LEAs may implement their own Ed-Fi ODS/API or receive data services from an ESA.

---

## 28. ESA (Education Service Agency) 🟢
**Best sources:**
- `docs/getting-started/esa-playbook/readme.md`
- `odsApi_versioned_docs/version-7.3/how-to-guides/multi-tenant-deployment-with-powershell.md`

**Draft definition:**
A regional or intermediate education organization that provides shared services (including Ed-Fi data infrastructure) to multiple LEAs within a geographic area. ESAs often operate multi-tenant Ed-Fi deployments, serving as a "data hub" for member districts. The Ed-Fi Alliance publishes a dedicated ESA Playbook for this stakeholder type.

---

## 29. System Integrator (SI) 🟢
**Canonical term:** **System Integrator** (abbrev. SI)
**Deprecated alias:** ~~System Implementor~~ — not used in Ed-Fi documentation; standardize on *System Integrator*.

**Best sources:**
- `docs/reference/10-educator-pipeline/1-clinical-experience/mapping-guidance.md`
- `docs/reference/10-educator-pipeline/2-program-diversity/mapping-guidance.md`
- `docs/getting-started/sea-playbook/implementation/ed-fi-installation-environments.md`
- `docs/getting-started/provider-playbook/implementation/ed-fi-api-integration-architecture-for-data-providers.md`

**Draft definition:**
An organization or individual with technical expertise in deploying, configuring, and extending Ed-Fi technology on behalf of education agencies. System Integrators (SIs) assist agencies with implementation planning, data mapping, ODS/API deployment, and vendor onboarding. They differ from Managed Service Providers in that SIs typically provide professional services rather than ongoing hosted infrastructure. The Ed-Fi Alliance recommends that new SEA implementers engage a qualified SI or Managed Service Provider with prior Ed-Fi experience.

---

## 30. Managed Service Provider (MSP) 🟢
**Best sources:**
- `docs/partners/1-badging/available-badges/ed-fi-managed-ods-api-platform-badge.md`
- `docs/getting-started/sea-playbook/implementation/ed-fi-installation-environments.md`

**Draft definition:**
An organization that hosts and operates the Ed-Fi ODS/API and related infrastructure on behalf of education agencies, typically in a cloud environment. MSPs may hold the Ed-Fi Managed Service Provider Badge. They handle infrastructure provisioning, multi-tenant configuration, school year rollover, and vendor onboarding for their agency clients.

---

## 30. Ed-Fi Documentation Site 🟢
**Best sources:**
- `CLAUDE.md`
- `README.md`
- `eng/docs/rebrand-design-doc/rebrand-design-doc.md`

**Draft definition:**
The public-facing technical documentation website for the Ed-Fi Alliance, published at `docs.ed-fi.org`. Built with Docusaurus 3 and sourced from the `ed-fi-alliance-oss.github.io` GitHub repository, the site contains four primary content sections: Getting Started, Partners, Reference, and Community. It hosts versioned documentation for the ODS/API, Data Standard, Admin API, Admin App, and other tools.

---

## 31. Data Management Service Platform 🟡 *(emerging / roadmap)*
**Corrected name:** **Data Management Service Platform** (not just "DMS")

**Best sources:**
- `docs/reference/0-roadmap/notifications/` (roadmap notifications)
- `blog/` (multiple posts referencing DMS as ODS/API successor)
- `Semantic_Index.md` (gap noted: no `/reference/dms/` folder exists as of May 2026)

**Platform components:**
| Component | Alias | Role | Status |
|---|---|---|---|
| **Ed-Fi API v8** | DMS API | Next-gen Resource API implementation; datastore-agnostic, cloud-native; successor to ODS/API | Coming soon |
| **Management Configuration Service (MCS)** | MCS | Next-gen platform administration API; successor to Admin API v2.x | Roadmap |

**Relationship to existing products:**
```
ODS/API Platform (v5.4 – v7.3)              Data Management Service Platform (v8+)
├── ODS/API  ───────────────────────────────▶  Ed-Fi API v8
└── Admin API v2.x  ────────────────────────▶  Management Configuration Service (MCS)
```

**Aliases:** DMS, Ed-Fi API v8, ODS/API v8, DMS Platform

**Data Store Instance alias:** `dmsInstance` (equivalent to `odsInstance` in pre-v8 deployments — see concept #5)

**Draft definition:**
The Data Management Service Platform is the next-generation successor to the Ed-Fi ODS/API Platform. It consists of two components: **Ed-Fi API v8** (a cloud-native, datastore-agnostic replacement for the ODS/API) and the **Management Configuration Service (MCS)** (a programmatic administration API replacing Admin API v2.x). Unlike the ODS/API, the DMS Platform is not bound to a relational SQL database. As of May 2026, no dedicated reference documentation section exists; primary documentation lives in blog posts and roadmap notifications.

> ⚠️ Noted docs gap (Semantic_Index.md #7): recommend creating `reference/11-data-management-service/` as a stub with an orientation page and roadmap link.

---

## 32. MetaEd 🟢
**Best sources:**
- `docs/reference/4-metaed/` (full section)
- `odsApi_versioned_docs/*/platform-dev-guide/coding-patterns.md`

**Draft definition:**
A domain-specific language (DSL) and IDE toolset developed by the Ed-Fi Alliance for defining the Ed-Fi Data Standard and generating downstream artifacts from a single source of truth. MetaEd generates ODS database schemas, REST API specifications, XSD interchange schemas, and Data Handbook documentation. Originally built as an Atom IDE plugin; migrated to VS Code extension in v4.0. MetaEd is used both by the Ed-Fi Alliance to define the core Data Standard and by implementers to author and validate extensions.

---

## 34. API Publisher 🟢
**Best sources:**
- `docs/reference/5-api-publisher/` (full section)
- `blog/2025-07-29-admin-app-api-publisher-release-summary.md`

**Draft definition:**
An Ed-Fi tool for synchronizing data between two Ed-Fi ODS/API instances. The API Publisher reads data from a source ODS/API and writes it to a target ODS/API, handling change detection, connection management, and error remediation. It supports reverse paging, CloudWatch monitoring, Docker deployment, and configurable storage backends (SQL Server, PostgreSQL, AWS Parameter Store). Use cases include state-level data aggregation from district-level ODS instances.

---

## 35. Analytics Middle Tier (AMT) 🟢 *(deprecated)*
**Best sources:**
- `docs/reference/9-analytics-middle-tier/` (full section)
- `docs/reference/0-roadmap/notifications/amt.md`

**Status:** **DEPRECATED** — transitioning to Ed-Fi Exchange in 2025.

**Draft definition:**
A set of denormalized SQL views layered over the Ed-Fi ODS database, designed to simplify analytics and reporting integrations with tools such as Power BI, Tableau, and Qlik. AMT eliminates the need for analytics consumers to understand the normalized ODS schema. It was maintained by the Ed-Fi Alliance and is now transitioning to community maintenance via the Ed-Fi Exchange. New implementations should evaluate community-maintained alternatives or direct ODS querying.

> ⚠️ Deprecation notice is only in the Roadmap Notifications section, not on the AMT landing page — a known gap per Semantic_Index.md.

---

## 36. Ed-Fi Extension 🟢
**Best sources:**
- `docs/reference/1-data-exchange/extensions-framework/readme.md`
- `odsApi_versioned_docs/*/platform-dev-guide/extensibility-customization/`
- `odsApi_versioned_docs/*/how-to-guides/how-to-extend-the-ed-fi-ods-api-student-transportation-example.md`

**Draft definition:**
A formal mechanism for adding domain-specific entities, associations, or attributes to the Ed-Fi Data Standard beyond the core model, without modifying the core standard itself. Extensions are defined using the MetaEd DSL and follow the Ed-Fi Extensions Framework conventions. Deployed extensions coexist with core ODS/API resources and are namespaced to prevent conflicts. Common use cases include state-specific data elements, EPP-specific entities, and custom assessment fields.

---

## 37. Ed-Fi API Profile 🟢
**Best sources:**
- `odsApi_versioned_docs/*/platform-dev-guide/api-profiles.md`
- `docs/reference/0-roadmap/advisories/profiles-in-multi-tenancy.md`

**Draft definition:**
A configuration mechanism in the Ed-Fi ODS/API that constrains the set of resources, HTTP methods, and data elements exposed to a specific API consumer. Profiles enable platform hosts to create purpose-built API views (e.g., a profile exposing only assessment data, or a read-only profile for reporting). Profiles are defined in XML and managed through the Admin API or Admin App. They are a key tool for implementing least-privilege data access.

---

## 38. Ed-Fi Descriptor 🟢
**Best sources:**
- `docs/reference/1-data-exchange/api-guidelines/design-and-implementation-guidelines/api-design-guidelines/ed-fi-descriptors.md`
- `docs/reference/1-data-exchange/technical-articles/descriptor-guidance.md`
- `Semantic_Index.md` (Key Terminology section)

**Draft definition:**
Ed-Fi's enumeration system for standardizing coded values across education data (e.g., grade levels, race/ethnicity, course subjects). Descriptors replace traditional lookup tables with a namespace-qualified, extensible vocabulary that can be customized per deployment while maintaining interoperability. Each descriptor has a `namespace`, `codeValue`, and `shortDescription`. SEAs commonly define their own descriptor namespaces aligned to state-specific code sets.

---

## 39. Unifying Data Model (UDM) 🟢
**Best sources:**
- `docs/reference/1-data-exchange/udm/` (full section)
- `docs/reference/1-data-exchange/udm/getting-started/core-concepts.md`
- `Semantic_Index.md` (Key Terminology section)

**Draft definition:**
The semantic framework that underpins the Ed-Fi Data Standard. The UDM defines the conceptual entities, relationships, and constraints for K-12 education data across domains including Student, Staff, Assessment, Enrollment, Finance, and Educator Preparation. It is expressed as UML class diagrams and serves as the single source of truth from which MetaEd generates concrete artifacts (database schema, REST API, XSD). The UDM is versioned alongside the Data Standard.

---

## Summary Table

| # | Concept | Confidence | Primary Source Path |
|---|---|---|---|
| 1 | Ed-Fi Product | 🟢 | `docs/reference/0-roadmap/` |
| 2 | Ed-Fi Community | 🟢 | `docs/partners/2-certification/` |
| 3 | Educator Pipeline | 🟢 | `docs/reference/10-educator-pipeline/` |
| 4 | Technology Roadmap | 🟢 | `docs/reference/0-roadmap/readme.mdx` |
| 5 | Data Store Instance | 🟡 | *(emerging — `odsInstance` / `dmsInstance` aliases)* |
| 6 | API Specification | 🟢 | `docs/reference/1-data-exchange/api-guidelines/` |
| 7 | Ed-Fi Tenant | 🟢 | `odsApi_versioned_docs/.../single-and-multi-tenant-configuration.md` |
| 8 | Ed-Fi Deployment | 🟢 | `odsApi_versioned_docs/.../deployment/` |
| 9 | Ed-Fi Vendor | 🟢 | `odsApi_versioned_docs/.../security/security-configuration-data-stores.md` |
| 10 | Ed-Fi Partner | 🟢 | `docs/partners/2-certification/certification-for-data-providers/partner-program.md` |
| 11 | Ed-Fi Certification | 🟢 | `docs/partners/2-certification/` |
| 12 | Ed-Fi Badge | 🟢 | `docs/partners/1-badging/` |
| 13 | Ed-Fi Playbook | 🟢 | `docs/getting-started/*/readme.md` |
| 14 | Ed-Fi Exchange | 🟢 | `docs/getting-started/edfi-exchange/readme.mdx` |
| 15 | Data Standard | 🟢 | `dataStandard_versioned_docs/` |
| 16 | Data Standard Version | 🟢 | `odsApi_versioned_docs/.../whats-new/` |
| 17 | Ed-Fi Data Model | 🟢 | `odsApi_versioned_docs/.../platform-dev-guide/fundamentals.md` |
| 18 | Ed-Fi Data Handbook | 🟢 | `docs/reference/1-data-exchange/udm/getting-started/core-concepts.md` |
| 19 | ODS/API Platform | 🟢 | `odsApi_versioned_docs/` *(v5.4–v7.3 + v8 roadmap)* |
| 20 | Admin API | 🟢 | `docs/reference/3-admin-api/whats-new.md` *(v1.0–v2.3)* |
| 21 | Admin App v4 *(current)* | 🟢 | `docs/reference/admin-app/` |
| 22 | ODS Admin App v3 *(legacy)* | 🟢 | `docs/reference/ods-admin-app/` |
| 23 | Data Import Tool | 🟢 | `docs/reference/6-data-import/` |
| 24 | Education Organization | 🟢 | `dataStandard_versioned_docs/.../education-organization-domain/` |
| 25 | SEA | 🟢 | `docs/getting-started/sea-playbook/` |
| 26 | LEA | 🟢 | `docs/community/involved/dictionary.md` |
| 27 | ESA | 🟢 | `docs/getting-started/esa-playbook/` |
| 28 | System Integrator (SI) | 🟢 | `docs/getting-started/sea-playbook/implementation/` |
| 29 | Managed Service Provider | 🟢 | `docs/partners/1-badging/available-badges/ed-fi-managed-ods-api-platform-badge.md` |
| 30 | Ed-Fi Documentation Site | 🟢 | `CLAUDE.md`, `README.md` |
| 31 | Data Management Service Platform | 🟡 | `blog/` + roadmap notifications *(no ref docs yet)* |
| 32 | MetaEd | 🟢 | `docs/reference/4-metaed/` |
| 33 | API Publisher | 🟢 | `docs/reference/5-api-publisher/` |
| 34 | Analytics Middle Tier (AMT) | 🟢 | `docs/reference/9-analytics-middle-tier/` *(deprecated)* |
| 35 | Ed-Fi Extension | 🟢 | `docs/reference/1-data-exchange/extensions-framework/` |
| 36 | Ed-Fi API Profile | 🟢 | `odsApi_versioned_docs/.../platform-dev-guide/api-profiles.md` |
| 37 | Ed-Fi Descriptor | 🟢 | `docs/reference/1-data-exchange/api-guidelines/.../ed-fi-descriptors.md` |
| 38 | Unifying Data Model (UDM) | 🟢 | `docs/reference/1-data-exchange/udm/` |

