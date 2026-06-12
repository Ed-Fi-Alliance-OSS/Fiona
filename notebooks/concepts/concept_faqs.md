# Ed-Fi Concept FAQs (User Story Format)

This document provides a list of frequently asked questions for each core concept, formatted as user stories to help evaluate implementation complexity and persona-specific needs.

---

## 1. Ed-Fi Product
- **What defines an Ed-Fi Product?**  
  A software component or technology implementation maintained by the Ed-Fi Alliance or contributed by the community that aligns with the Ed-Fi Data Standard.
- **Which products are part of the core Ed-Fi Technology Suite?**  
  The suite includes the ODS/API, Admin API, Admin App, Data Import, and API Publisher.
- **How are community-contributed tools categorized?**  
  Tools developed by the community that support Ed-Fi standards are often hosted on the Ed-Fi Exchange.
- **Where can I find the support lifecycle for a product?**  
  Product lifecycle windows and support statuses are communicated via the Ed-Fi Technology Roadmap.
- **As a Developer, how do I know which product version to build against?**  
  Check the Compatibility Matrix in the Roadmap section to ensure your version aligns with the Data Standard version required by your target audience.
- **As an SEA, how does product selection impact statewide strategy?**  
  SEAs typically mandate specific product versions (e.g., ODS/API v7.x) to ensure uniform data collection across all LEAs.
- **As a System Architect, why is product versioning considered complex?**  
  Because products like the Admin API and ODS/API have independent versioning tracks that must be cross-referenced for compatibility.

## 2. Ed-Fi Community
- **Who belongs to the Ed-Fi Community?**  
  The community includes SEAs, LEAs, technology providers (vendors), and system integrators.
- **What is the Ed-Fi Community Hub?**  
  It is the central platform (community.ed-fi.org) for collaboration, feedback, and technical support.
- **How does the community participate in governance?**  
  Community members can join workgroups, provide feedback on proposed changes, and contribute to the open-source roadmap.
- **As a Vendor, how can I leverage the community to improve my product?**  
  Participate in the Slack channels and Special Interest Groups (SIGs) to understand emerging requirements from state agencies.
- **As an SEA, how do I find other states solving similar problems?**  
  The Community Hub and the Ed-Fi Exchange provide forums and repositories where states share their implementation playbooks.
- **As a Policy Lead, how does community feedback influence the Data Standard?**  
  Feedback is funneled through the "Proposed Changes" process, which involves multi-step reviews and public comment periods.

## 3. Educator Pipeline
- **What is the Educator Pipeline in the Ed-Fi context?**  
  It refers to the data journey of an educator from preparation and certification through employment and professional development.
- **What data model supports the Educator Pipeline?**  
  The Educator Preparation Data Model (EPDM) is the primary framework for these data entities.
- **Who are the primary stakeholders for Educator Pipeline data?**  
  Teacher preparation programs (EPPs) and state education agencies (SEAs) tracking workforce trends.
- **As an EPP Administrator, what specific data can I track?**  
  You can track candidate clinical experiences, certification exam results, and employment outcomes.
- **As an SEA, how can I use pipeline data to address teacher shortages?**  
  By aggregating data from EPPs and LEAs, states can identify regions with the highest attrition and tailor recruitment efforts.
- **As a Data Engineer, why is EPDM implementation more difficult than core SIS integration?**  
  It often requires bridging data from disparate sources (Higher Ed and K-12) that may not have shared identifiers.

## 4. Technology Roadmap
- **What is the purpose of the Ed-Fi Technology Roadmap?**  
  It communicates upcoming features, product deprecations, and development priorities.
- **Where is the official roadmap hosted?**  
  The roadmap is maintained on GitHub and summarized on the documentation site.
- **How can I influence the roadmap?**  
  Community members can file issues and participate in roadmap discussions on GitHub.
- **As an IT Director, how far in advance should I plan for upgrades?**  
  The roadmap typically provides a 2-year notice for major version deprecations, allowing for budget and resource planning.
- **As a Vendor, how do I align my product release with Ed-Fi updates?**  
  Monitor the "Release Cadence" page to anticipate when new major versions of the ODS/API will be available for testing.
- **As an Architect, what is a "Roadmap Notification"?**  
  These are official advisories about breaking changes or strategic shifts (like the move to DMS) that require immediate architectural attention.

## 5. Data Store Instance
- **What is a Data Store Instance?**  
  A generic term for a provisioned instance of an Ed-Fi data repository.
- **What is the difference between an `odsInstance` and a `dmsInstance`?**  
  `odsInstance` refers to a SQL database in ODS/API v7.x, while `dmsInstance` refers to the equivalent in the v8+ DMS Platform.
- **How are instances scoped?**  
  Instances are typically scoped by tenant, education organization, and school year.
- **As a DBA, how do I manage 500+ ODS instances efficiently?**  
  Use the Admin API to automate the creation, backup, and school-year-rollover of instances.
- **As a Multi-tenant Host, when should I use a single ODS vs. multiple ODS instances?**  
  Multiple instances are used when data isolation is required by law or when different districts operate on different school year cycles.
- **As a Platform Developer, what are "Derivatives" in instance management?**  
  In v7.x, Derivatives allow for read-only or year-specific views of a primary instance, adding a layer of management logic.

## 6. Ed-Fi API Specification
- **What is an Ed-Fi API Specification?**  
  A formal document defining the RESTful interface (resources, verbs, schemas) for Ed-Fi data exchange.
- **Which API specifications are required for "Ed-Fi Compatible" status?**  
  Implementations must support the Resource API and the Discovery API.
- **What is the role of the Discovery API?**  
  It provides metadata about the implementation, including software versions and authentication endpoints.
- **As a Developer, how do I validate my API calls against the spec?**  
  Use the provided OpenAPI (Swagger) definitions to generate clients and validate request payloads.
- **As an Integration Specialist, how do I handle large-scale data syncs?**  
  Implement the "Change Queries API" specification to perform incremental updates rather than full bulk loads.
- **As a Backend Engineer, why are there multiple specifications (Identity, Admin, Resource)?**  
  Each specification addresses a different architectural concern (Auth, Metadata, CRUD), requiring different security and logic implementations.

## 7. Ed-Fi Tenant
- **What is a "Tenant" in an Ed-Fi deployment?**  
  A logical partition that isolates data for a specific organization within a shared ODS/API environment.
- **When was multi-tenancy introduced?**  
  Multi-tenancy was a major feature introduced in ODS/API v7.0.
- **What resources are unique to a tenant?**  
  Each tenant has its own dedicated administration (`EdFi_Admin`) and security (`EdFi_Security`) databases.
- **As an MSP Architect, how do I ensure one district cannot see another's data?**  
  Tenants provide hard isolation at the database level, and the API ensures requests are scoped to the correct tenant ID.
- **As an SEA managing a Statewide Hub, how many tenants should I have?**  
  Typically, one tenant per LEA or one tenant per regional data hub, depending on the governance model.
- **As a Web Developer, how does multi-tenancy affect API URLs?**  
  URLs must include a tenant identifier, which adds complexity to client-side configuration and routing.

## 8. Ed-Fi Deployment
- **What constitutes an Ed-Fi Deployment?**  
  An active installation of Ed-Fi components (API, database, admin tools) in a specific environment.
- **What are the common deployment modes?**  
  Deployments can be single-tenant or multi-tenant, and may be hosted on-premises or in the cloud.
- **How is a deployment managed?**  
  Managed via the Admin App or programmatically through the Admin API.
- **As a DevOps Engineer, should I use Docker or Binary installation?**  
  Docker is recommended for scalability and cloud-native environments, while Binary is often used for legacy on-premises Windows servers.
- **As a Developer, how do I set up a Sandbox for a development environment?**  
  Deploy a "Sandbox" mode instance which includes pre-populated sample data and a simplified security model.
- **As a System Architect, what is the "Year-Specific" vs. "District-Specific" deployment choice?**  
  This architectural decision impacts how data is partitioned and how users transition between school years.

## 9. Ed-Fi Vendor
- **How are vendors defined in the Ed-Fi ecosystem?**  
  Vendors are organizations that develop systems to exchange data with the Ed-Fi ODS/API.
- **What is required for a vendor to integrate?**  
  Vendors must be registered and obtain credentials (keys/secrets) to access specific data scopes.
- **What are vendor namespaces?**  
  Namespaces are prefixes used to isolate vendor-specific data elements and extensions.
- **As a Product Manager, how do I get my product "Ed-Fi Certified"?**  
  Register as a partner, implement the required API endpoints, and pass the automated certification tests.
- **As an SIS Provider, how do I manage multiple clients on one ODS?**  
  Vendors are associated with specific "Applications" in the Admin database, which can be mapped to one or more LEAs.
- **As a Security Lead, what is the "Namespace Prefix" requirement?**  
  Vendors must only write data to namespaces they own, which requires careful configuration of authorization claim sets.

## 10. Ed-Fi Partner
- **What is the Ed-Fi Partner Program?**  
  A formal program for organizations that wish to achieve certification and engage deeply with the Alliance.
- **Who can become an Ed-Fi Partner?**  
  Technology providers, managed service providers, and system integrators.
- **Is partnership required for certification?**  
  Yes, becoming a partner is a prerequisite for pursuing formal Ed-Fi Certifications.
- **As a Sales Executive, what is the business value of partnership?**  
  Partners gain visibility in the Ed-Fi registry, which is frequently used by SEAs and LEAs during the procurement process.
- **As a New Vendor, how do I start the journey?**  
  Follow the "Provider Playbook" which outlines the steps from joining the program to achieving your first badge.
- **As a Business Analyst, what is the difference between a "Technology Partner" and an "Implementation Partner"?**  
  Technology partners build software; Implementation partners provide services. Each has different requirements and benefits.

## 11. Ed-Fi Certification
- **What does Ed-Fi Certification signify?**  
  It verifies that a product meets specific standards for data exchange and API conformance.
- **How long does a certification last?**  
  Certifications are active for one year and must be renewed annually.
- **Where can I see a list of certified products?**  
  A registry is available on the Ed-Fi documentation site.
- **As a QA Lead, what is the "Certification Suite"?**  
  A set of automated tests that validate your API implementation against specific use cases (e.g., Chronic Absenteeism).
- **As an LEA, why should I require certification in my RFP?**  
  It ensures the vendor's product can actually "talk" to your Ed-Fi ODS without costly custom development.
- **As a Developer, what is the difference between "SIS Certification" and "Assessment Certification"?**  
  Each certification has different required data domains and API endpoints, reflecting the unique data needs of each system type.

## 12. Ed-Fi Badge
- **What is an Ed-Fi Badge?**  
  A lighter credential recognizing a product's support for specific Ed-Fi features.
- **What is the difference between a Badge and a Certification?**  
  Badges cover areas not yet in formal certification and typically last two years.
- **Which products can earn a Managed Service Provider Badge?**  
  Organizations that host and operate Ed-Fi platforms for agencies.
- **As a Marketing Manager, where can I use the Ed-Fi Badge logo?**  
  Once awarded, you can use the badge on your website and marketing materials following the Ed-Fi Brand Guidelines.
- **As a State Agency, how do I find a "Managed Service Provider"?**  
  Look for organizations in the registry that hold the "Managed ODS/API Platform" badge.
- **As a Product Architect, why is a Badge valid for 2 years while Certification is only 1?**  
  Badges represent broader capabilities that change less frequently than the specific data mappings required for certification.

## 13. Ed-Fi Playbook
- **What is an Ed-Fi Playbook?**  
  A strategic guide designed for specific audiences (SEA, LEA, Vendor) to help them plan implementations.
- **Which playbooks are available?**  
  SEA Playbook, Provider Playbook, and ESA Playbook.
- **Are playbooks available in different formats?**  
  Yes, available as interactive documentation, PDFs, and PowerPoint templates.
- **As an SEA Lead, which playbook section is most critical for governance?**  
  The "Governance and Sustainability" sections provide templates for data sharing agreements and committee structures.
- **As an Implementation Lead, I'm a new vendor, where do I begin?**  
  Start with the "Technology Provider Ed-Fi Journey" section of the Provider Playbook.
- **As a Documentation Manager, how do I keep my local copy of the playbook in sync?**  
  Playbooks are versioned; it's recommended to use the online version to ensure you have the latest guidance.

## 14. Ed-Fi Exchange
- **What is the Ed-Fi Exchange?**  
  A community-driven repository for sharing open-source tools, extensions, and implementation guides.
- **Who can contribute to the Exchange?**  
  Any member of the Ed-Fi community can submit contributions.
- **What happens to deprecated core tools?**  
  Tools like AMT are sometimes transitioned to the Exchange for community maintenance.
- **As an Open Source Developer, how do I submit a tool?**  
  Follow the contribution guidelines on GitHub (`Ed-Fi-Exchange-OSS`) and submit a Pull Request.
- **As an Analyst, where can I find pre-built Power BI templates?**  
  Search the Exchange for community-contributed analytics dashboards.
- **As a Technical Lead, what is the "Community-Maintained" support tier?**  
  It means the Ed-Fi Alliance no longer provides official support, and users rely on the community for bug fixes.

## 15. Ed-Fi Data Standard
- **What is the Ed-Fi Data Standard?**  
  The core rules and definitions (UDM, API specs) that enable interoperability.
- **How is the Data Standard versioned?**  
  It is versioned independently of the ODS/API platform.
- **Can one API version support multiple Data Standards?**  
  Yes, ODS/API v7.3 supports simultaneous operation of multiple Data Standard versions.
- **As a Data Architect, how do I map my legacy data to DS v6?**  
  Use the "Data Standard v6 Whats New" guide to identify entity changes and removals from previous versions.
- **As an SEA, should I skip DS v4 and go straight to v6 for a statewide migration?**  
  If your vendor ecosystem supports it, going to the latest standard minimizes the frequency of future migrations.
- **As a Developer, what are "Breaking Changes" in a new Data Standard?**  
  These are modifications (like renaming a key field) that require all API clients to update their code to stay compatible.

## 16. Ed-Fi Data Model & UDM
- **What is the Unifying Data Model (UDM)?**  
  The conceptual semantic framework that defines education entities and relationships.
- **How is the UDM related to the ODS database?**  
  The ODS schema is automatically generated from the UDM using MetaEd.
- **What are the primary domains in the UDM?**  
  Student, Staff, Enrollment, Assessment, and Finance.
- **As a Data Modeler, how do I propose a change to the UDM?**  
  Submit a proposal through the "Proposed Changes" section of the site, including UML diagrams if possible.
- **As a Developer, can I add a field to a core entity for a custom extension?**  
  No, you cannot modify core entities directly. You must use the "Extensions Framework" to add new data elements.
- **As a Technical Architect, what is the "Semantic Origin" of the UDM?**  
  The UDM is authored in MetaEd, meaning its "truth" is in code, not just in the visual UML diagrams.

## 18. Ed-Fi Data Handbook
- **What is the Ed-Fi Data Handbook?**  
  A human-readable reference guide for all entities and attributes in the Data Standard.
- **Who is the primary audience for the Data Handbook?**  
  Data analysts, developers, and business stakeholders.
- **Is there a handbook for custom extensions?**  
  Yes, MetaEd can generate a project-specific handbook.
- **As a Data Analyst, how do I find the definition of "Chronic Absenteeism"?**  
  Search the handbook for the relevant student/attendance entities to see the underlying data definitions.
- **As an SEA, how do I use the handbook for training and onboarding?**  
  Use the Handbook as the primary training manual for understanding the "Language of Ed-Fi."
- **As a Developer, why are there different handbooks for different versions?**  
  Because entities and attributes change between versions (e.g., DS v5 to v6), and each version is a distinct source of truth.

## 19. ODS/API Platform
- **What is the ODS/API Platform?**  
  The reference implementation of the Ed-Fi standards.
- **Which databases are supported?**  
  SQL Server and PostgreSQL.
- **What is the strategic successor to the ODS/API?**  
  The cloud-native DMS Platform.
- **As a System Administrator, how do I monitor performance?**  
  The ODS/API provides health check endpoints and can be configured to export logs to CloudWatch or Serilog.
- **As an Architect, how do I scale the ODS/API to handle 1 million students?**  
  Use a multi-tenant or multi-ODS architecture and significant database optimization.
- **As a System Architect, what is the "Suite 3" vs. "v7" architecture change?**  
  The transition to v7 introduced .NET 6/8 and multi-tenancy, requiring a significant architectural rethink for hosts.

## 21. Admin API
- **What is the Admin API?**  
  A REST API used to programmatically manage Ed-Fi platform configurations.
- **How does it relate to the Admin App?**  
  The Admin App v4 is a UI that sits on top of the Admin API.
- **Can I use the Admin API for automation?**  
  Yes, specifically designed for automated provisioning.
- **As a DevOps Engineer, how do I automate client credential rotation?**  
  Use the Admin API `applications/{id}/reset-credentials` endpoint.
- **As an MSP providing Managed Hosting, how do I onboard a new district automatically?**  
  Create a script that calls the Admin API to create a Tenant, an ODS Instance, and a Vendor Application in sequence.
- **As a Developer, why is the Admin API versioned separately from the ODS/API?**  
  Because one version of the Admin API (e.g., v2.3) often supports multiple ODS/API versions (v6.x and v7.x).

## 22. Admin App v4
- **What is Admin App v4?**  
  The current web interface for administrators to manage multi-tenant deployments.
- **What are the key improvements in v4?**  
  Multi-tenant support and built on Admin API v2.x.
- **Who should use Admin App v4?**  
  IT staff at SEAs, ESAs, and MSPs.
- **As an IT Manager, how do I delegate tasks to my team?**  
  Admin App v4 supports roles that allow you to give specific users access to manage only certain tenants or vendors.
- **As a System Admin, how do I migrate from v3 to v4?**  
  v4 requires the Admin API to be installed first; the migration involves re-registering your vendors in the new system.
- **As a DevOps Engineer, what is the "Environment" configuration in Admin App?**  
  It allows you to manage Production, Sandbox, and Testing environments from a single UI dashboard.

## 23. ODS Admin App (v3)
- **What is the ODS Admin App?**  
  The legacy administrative web interface for Suite 3.
- **Should I use ODS Admin App for new deployments?**  
  No, use Admin App v4.
- **Is ODS Admin App the same as Sandbox Admin?**  
  No, they are being consolidated into v4.
- **As a Legacy User, why is my ODS Admin App no longer receiving updates?**  
  It is in maintenance mode and will reach end-of-life as agencies migrate to ODS/API v7+.
- **As a developer providing Suite 3 Support, can I still manage ODS v5.x with this?**  
  Yes, v3 is the primary tool for managing legacy v5.x and v6.x (non-multi-tenant) deployments.
- **As a System Architect, what is the "Profile" management feature in v3?**  
  It allows for basic XML-based profile uploads, but lacks the advanced multi-tenant support found in v4.

## 24. Data Import Tool
- **What is the Data Import Tool?**  
  A utility for loading bulk CSV data into the ODS/API.
- **How does it map CSVs to the API?**  
  Uses configurable templates.
- **Is Data Import still being actively developed?**  
  It is transitioning to community maintenance on the Exchange.
- **As a Data Coordinator, do I need to be a programmer to use this?**  
  No, it is designed for users who can map CSV headers to API field names through a web interface.
- **As an LEA at a Small District, how do I get data into Ed-Fi without a modern SIS?**  
  Export your data to CSV and use Data Import with a pre-built template from the Exchange.
- **As a Developer, what are "Mapping Templates"?**  
  These are JSON files that define complex transformations, which can be difficult to author without understanding the UDM.

## 25. Education Organization
- **What is an Education Organization in Ed-Fi?**  
  An abstract entity representing any body involved in education.
- **How is this concept used in security?**  
  Primary anchor for the authorization model.
- **What are the concrete subtypes of Education Organization?**  
  SEA, LEA, School, etc.
- **As a Security Admin, how do I restrict a vendor to only one school?**  
  Assign the vendor's application a "Claim Set" and scope it to the specific School ID in the security database.
- **As a Data Architect, how do I model a district hierarchy with 10 schools?**  
  Create one LEA entity and 10 School entities, using the `ParentEducationOrganizationId` to link them.
- **As a Backend Developer, why is "Education Organization" an abstract class?**  
  Because many API resources (like Staff) can be associated with *any* type of organization, requiring a common parent type.

## 26. SEA (State Education Agency)
- **What is an SEA's role in Ed-Fi?**  
  SEAs implement Ed-Fi for statewide data collection.
- **How do SEAs encourage vendor adoption?**  
  Mandating Certification in RFPs.
- **Where can SEAs find guidance?**  
  The Ed-Fi SEA Playbook.
- **As a State CIO, how do I justify the cost of Ed-Fi?**  
  Focus on the long-term savings of eliminating custom point-to-point integrations and improving data quality for federal reporting.
- **As an SEA managing a Statewide Hub, should I host a central ODS or have districts host their own?**  
  Many states move toward a "Hybrid" model where districts host local ODSs that "Publish" data to a central state ODS.
- **As a Policy Lead, what is "Statewide Governance"?**  
  The complex process of aligning all LEAs on a single Data Standard version and set of Descriptors.

## 27. LEA (Local Education Agency)
- **What is an LEA in the Ed-Fi model?**  
  A school district or local body.
- **How do LEAs interact with the ODS/API?**  
  Source of data and primary consumers of dashboards.
- **Can an LEA host its own Ed-Fi instance?**  
  Yes, or use an ESA/MSP.
- **As a District Data Manager, how do I get my SIS vendor to support Ed-Fi?**  
  Point them to the "Provider Playbook" and inform them that you require Ed-Fi Certification for your contract.
- **As an LEA, how do I see real-time student performance via Dashboards?**  
  Ensure your SIS is pushing data to the LEA's ODS/API daily, and connect a visualization tool to the ODS database.
- **As a System Admin, what is "School Year Rollover" for an LEA?**  
  The technical process of archiving the previous year's ODS and provisioning a new one for the upcoming year.

## 28. ESA (Education Service Agency)
- **What is an ESA's unique role?**  
  Regional intermediaries hosting multi-tenant platforms.
- **What is an "ESA Data Hub"?**  
  A shared Ed-Fi deployment managed by an ESA.
- **Is there specific guidance for ESAs?**  
  The Ed-Fi ESA Playbook.
- **As a Regional Director, how do I provide value to small districts?**  
  By hosting a shared Ed-Fi platform, you allow small districts to benefit from advanced analytics without hiring their own IT staff.
- **As an ESA providing Shared Services, how do I bill districts for Ed-Fi hosting?**  
  The ESA Playbook provides models for cost-sharing based on student count or flat-fee membership.
- **As a System Architect, what is "Delegated Administration" in an ESA hub?**  
  Allowing district-level staff to manage their own API keys within the ESA's multi-tenant Admin App.

## 29. System Integrator (SI)
- **What does a System Integrator do?**  
  Provide professional services to help agencies plan and customize Ed-Fi.
- **How does an SI differ from an MSP?**  
  SIs focus on implementation; MSPs focus on hosting.
- **How can I find a qualified SI?**  
  Check the Ed-Fi Partner Registry.
- **As a Project Manager, when should I hire an SI?**  
  Hire an SI during the "Planning" phase to help with data mapping, vendor engagement, and architectural design.
- **As an SEA implementing a Custom Extension, can an SI help?**  
  Yes, an SI can author the MetaEd extension, update the ODS schema, and help vendors map their data to the new fields.
- **As an IT Manager, what is the "Knowledge Transfer" requirement when working with an SI?**  
  The risk that an agency becomes dependent on an SI; successful SIs train agency staff to maintain the system long-term.

## 30. Managed Service Provider (MSP)
- **What services does an MSP provide?**  
  Host and operate Ed-Fi infrastructure on behalf of agencies.
- **What is the MSP Badge?**  
  A credential recognizing providers with a track record of hosting.
- **Why would an agency use an MSP?**  
  To reduce technical burden.
- **As a Cloud Architect, how do I architect a multi-state MSP platform?**  
  Use a "Global" Admin API to manage "Regional" multi-tenant ODS/API clusters across different Azure/AWS regions.
- **As an SEA needing Rapid Deployment, how can an MSP help?**  
  MSPs have pre-configured "Stack" templates that can provision a production-ready environment in hours.
- **As an IT Director, what is the "SLA" for an Ed-Fi MSP?**  
  Service Level Agreements must cover API uptime, data backup frequency, and response times for vendor onboarding issues.

## 30. Ed-Fi Documentation Site
- **What is the Ed-Fi Documentation Site?**  
  The central hub (docs.ed-fi.org) for all documentation.
- **How is the documentation site built?**  
  Docusaurus-based, sourced from GitHub.
- **Where can I find versioned documentation?**  
  Via the version selector on the site.
- **As a New Developer, where is the "Hello World" for Ed-Fi?**  
  Check the "Getting Started" section for the "Tutorial" and "Quick Start" guides.
- **As a User needing Offline Access, can I download the docs?**  
  The site is designed for online use, but specific sections like Playbooks are available as PDFs.
- **As a Documentation Manager, why are there two different version selectors?**  
  Because the ODS/API and the Data Standard are versioned independently, requiring separate navigation paths.

## 31. Data Management Service (DMS) Platform
- **What is the DMS Platform?**  
  Next-generation, cloud-native successor to the ODS/API.
- **What are the core components of DMS?**  
  Ed-Fi API v8 and MCS.
- **How does DMS differ from traditional ODS/API?**  
  Datastore-agnostic and cloud-native.
- **As a Platform Architect, when should I switch to DMS?**  
  Monitor the Technology Roadmap; the switch is recommended for new cloud-native deployments starting in 2026/2027.
- **As an Architect looking at NoSQL options, can I use DMS with MongoDB?**  
  Yes, DMS is designed to allow for non-relational backends, unlike the traditional SQL-bound ODS.
- **As a Developer, what is the "MCS" (Management Configuration Service)?**  
  It is the successor to the Admin API, featuring a completely new API design and configuration model.

## 32. MetaEd
- **What is MetaEd?**  
  DSL and IDE used to define the Data Standard and extensions.
- **What artifacts does MetaEd generate?**  
  DDL, OpenAPI, XSD, and Handbook files.
- **Do I need MetaEd to use Ed-Fi?**  
  Only for defining extensions or contributing to core.
- **As a Developer, how do I install the MetaEd IDE?**  
  It is available as a VS Code extension; check the "MetaEd Getting Started" guide for setup instructions.
- **As an SEA with a State Mandate for new fields, how do I add them?**  
  Author a `.metaed` file defining the fields, run the MetaEd generator, and apply the resulting SQL scripts to your ODS.
- **As a Data Engineer, what is the "MetaEd Language Specification"?**  
  The formal syntax rules for MetaEd; mastering it is required for building complex data relationships and associations.

## 34. API Publisher
- **What is the API Publisher?**  
  Tool to synchronize data between two Ed-Fi ODS/API instances.
- **When should I use API Publisher?**  
  Moving data from district to state ODS.
- **Does it handle delta updates?**  
  Yes, features for change detection and replication.
- **As a State Data Engineer, how do I handle 50 districts pushing data at once?**  
  Deploy the API Publisher in Docker with horizontal scaling and use a shared Configuration Store (PostgreSQL or SQL Server).
- **As a DBA, can I use Publisher to clone an ODS for data recovery?**  
  Yes, it can be used to perform a "Full Sync" from a production ODS to a reporting or backup ODS.
- **As a Performance Engineer, what is "Reverse Paging" in the Publisher?**  
  A performance optimization for reading large datasets from the source API without timing out.

## 35. Analytics Middle Tier (AMT)
- **What is the Analytics Middle Tier?**  
  SQL views that denormalize ODS data for BI tools.
- **What is the current status of AMT?**  
  Deprecated, transitioned to Exchange.
- **What should I use instead of AMT?**  
  Community alternatives or direct ODS querying.
- **As a Report Writer, are the AMT views still safe to use?**  
  Yes, for existing ODS v6.x deployments, but they may not support new entities introduced in DS v6.
- **As a Developer using Power BI, how do I connect to Ed-Fi?**  
  If using legacy ODS, install AMT and point Power BI to the `analytics` schema views.
- **As a Data Architect, why was AMT deprecated?**  
  Maintaining SQL views for every possible ODS version and extension became too complex for the core Alliance team.

## 36. Ed-Fi Extension
- **What is an Ed-Fi Extension?**  
  Standard way to add data elements without breaking compatibility.
- **How are extensions defined?**  
  Authored using MetaEd.
- **Are extensions namespaced?**  
  Yes, to avoid naming conflicts.
- **As a Vendor Developer, how do I consume an extension via the API?**  
  Extensions appear as sub-objects in the JSON response, usually under a property named after the extension namespace.
- **As a Developer creating a Custom Domain, how do I add an entity for "Student Jobs"?**  
  Create a new `Domain` and `Entity` in MetaEd; the generator will create the new API endpoints automatically.
- **As a Technical Architect, what is the "Extensions Framework" RFC?**  
  The formal set of rules that dictate how extensions must be structured to ensure they don't break the core API logic.

## 37. Ed-Fi API Profile
- **What is an Ed-Fi API Profile?**  
  Mechanism to restrict data and operations for a specific client.
- **How are profiles configured?**  
  Defined in XML and managed through Admin API/App.
- **Why use profiles?**  
  Least-privilege security and performance.
- **As a Privacy Officer, how do I hide "SSN" from a vendor?**  
  Create a Profile that excludes the `SocialSecurityNumber` element from the `Student` resource.
- **As a Developer needing Read-Only access, how do I prevent a vendor from deleting data?**  
  Apply a Profile that only allows the `GET` verb for the resources that vendor is authorized to see.
- **As a Security Architect, how do Profiles interact with Claim Sets?**  
  Claim Sets define *which* resources you can see; Profiles define *what parts* of those resources and *which actions* you can perform.

## 38. Ed-Fi Descriptor
- **What is an Ed-Fi Descriptor?**  
  System for standardizing coded values across the ecosystem.
- **How do Descriptors differ from traditional lookup tables?**  
  Namespace-qualified structure for easy customization.
- **Who defines Descriptor namespaces?**  
  Alliance defines core; SEAs define state-specific.
- **As an Implementation Consultant, how do I map local "School Types" to Ed-Fi?**  
  Create a mapping table between your local codes and the `SchoolTypeDescriptor` values in the ODS.
- **As a Developer ensuring Data Quality, what happens if a vendor sends an invalid code?**  
  The API will return a `400 Bad Request` because Descriptor values are validated against the entries in the ODS.
- **As a Data Engineer, what is "Descriptor XML" loading?**  
  The process of bulk-loading state-approved codes into a new ODS, which must be done before vendors can push data.

## 39. Unifying Data Model (UDM)
- **What is the Unifying Data Model?**  
  Central semantic model defining all entities and rules.
- **How is the UDM versioned?**  
  Versioned as part of the Data Standard.
- **What is the relationship between UDM and API?**  
  API resources are direct mappings of UDM entities.
- **As a Business Analyst, where can I see the visual relationships between Student and Enrollment?**  
  Check the "UDM Section" of the Reference docs for the UML class diagrams for the Enrollment domain.
- **As a Data Warehouse architect, how do I structure my warehouse to match Ed-Fi?**  
  Use the UDM as your star-schema blueprint to ensure semantic alignment with all source systems.
- **As a Data Architect, what is the "Natural Key" requirement in the UDM?**  
  The UDM requires every entity to have a unique natural key (like `StudentUniqueId`), which can be difficult for legacy systems to generate.
