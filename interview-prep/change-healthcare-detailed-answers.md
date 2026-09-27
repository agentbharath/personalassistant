# Change Healthcare — Detailed Interview Answer Guide

Prepared for Bharath Kumar Vaddineni. Covers all 120 questions and their follow-up branches from the supplied question sheet.

## How to use these answers

Your résumé lists Change Healthcare employment from **July 2023 to July 2024** and confirms the six achievements below. It does not identify the experimentation vendor, chart library, socket implementation, identity provider, deployment topology, or exact measurement baselines. General skills elsewhere on the résumé do not establish that you used those tools at Change Healthcare.

**Your follow-up confirms: Touchstone for experimentation, D3 for charts, and OAuth authentication.** These are the primary paths below. Touchstone’s deployment, assignment mechanism, and analysis engine remain unspecified; this guide does not infer them from the product name. OAuth is confirmed, but the exact flow, identity provider, and token storage still need confirmation.

**The answers below are rehearsal templates, not a reconstruction of undocumented experience.** First-person sample answers describe what you can say **if that approach matches your work**. Alternatives are mutually exclusive where appropriate: select your actual path. Replace bracketed placeholders with facts you remember or can verify. Numbers marked “illustrative” teach the calculation and are not your production measurements. Where you do not know an operational detail, explain your own responsibility and the design you would recommend instead of presenting it as historical fact.

Current documentation is linked where it clarifies a technical point. Current recommendations must not be described as features or standards you necessarily used in 2023–2024.

| Résumé claim | Established by the résumé | Details to recover before an interview |
|---|---|---|
| A/B testing | End-to-end experimentation; average session duration +30% | Platform, population, assignment unit, metric definition, baseline, sample size, uncertainty |
| Real-time dashboards | REST and WebSocket; data refresh latency reduced 25% | Chart/grid tools, freshness measurement, connection count, fan-out mechanism |
| Modular React | Hooks and component-driven reuse across distinct workflows | Actual components, consumer workflows, distribution and ownership |
| Testing | Jest and MochaJS; approximately 95% coverage enforced in CI; regressions reduced 20% | Coverage dimensions/scope, CI provider, time window and incident denominator |
| Bundle optimization | Webpack 5 dynamic imports/code splitting; initial bundle reduced 35% | Before/after initial-route bytes, compression, device and load measurements |
| API integration | Retry logic, graceful errors, OAuth2 in a HIPAA-regulated context | HTTP client, OAuth/OIDC flow, identity provider, token storage and backend controls |

## 1. A/B testing — 30% increase in average session duration

**Opening answer template:** “I owned the experiment from the hypothesis through UI delivery, instrumentation, and analysis. The hypothesis was that [specific UI change] would improve [specific user behavior]. We assigned eligible [users/accounts] to control or treatment, measured [precise session definition], and observed a 30% relative increase in average duration. I checked [actual task-success and reliability measures] to determine whether that represented useful engagement. My direct contribution was [implementation and analysis responsibilities].”

Do not invent the UI change: the résumé does not state what it was. For a task-oriented healthcare application, longer sessions can also indicate friction. If task-success checks were not performed, acknowledge that limit.

### 1.1 Which experimentation platform did you use?

**Your primary answer:** “We used Touchstone for experimentation. My work covered the experiment hypothesis, UI integration, instrumentation, and evaluation.” Then describe the actual boundary between Touchstone and your application: where a decision came from, how React received it, when exposure was recorded, and where outcome analysis ran. The résumé supports end-to-end experiment ownership, but it does not establish that Touchstone itself performed every one of these functions.

**Follow-up:** If asked whether Touchstone was in-house, client-side, or statistically self-contained, answer from your implementation or documentation. Its name alone does not establish those properties. A useful statement when a detail is outside your ownership is: “I owned the experiment integration; the platform team owned [actual platform function].” Do not substitute a familiar vendor’s architecture for Touchstone’s.

**Alternative platform comparisons, for learning rather than your project story:**

- **Optimizely Web:** Describe a browser-driven experiment. For a React-owned view, explain how route transitions and rerenders were handled; DOM rewriting can conflict with React. Identify the actual integration rather than calling every Optimizely setup an SDK-based React experiment.
- **Optimizely Full Stack/Feature Experimentation:** Describe SDK evaluation and selecting a React component from the returned decision. Use the product name/version from your project period.
- **LaunchDarkly or Split:** Flags can supply assignment, but explain whether your licensed product/version supplied experiment analysis or whether an internal pipeline joined exposure events to outcomes. “Flag tools first” does not imply these vendors never support statistics.
- **GrowthBook:** Explain the actual deployment. Self-hosting can provide operational control but adds upgrades, security, and uptime work; open source alone is not a privacy guarantee.
- **In-house:** Defend a narrow need such as existing internal allocation infrastructure or data constraints. Stable hashing, exposure data quality, statistical analysis, and operational ownership are real costs. Avoid saying it was simply easier to build.

### 1.2 Client-side or server-side evaluation, and why?

**Server-side path:** “We evaluated the variant during authenticated bootstrap and sent a safe variant identifier with the initial page data. The first render used that decision, reducing flicker and centralizing targeting.” If rendering was server-side, the browser needed the same decision during hydration. Personalized assignments must not leak through shared caches.

**Client-side path:** “The SPA evaluated a bootstrapped or locally cached flag configuration before displaying the experiment area. While assignment was unknown, we used a neutral placeholder. We had a bounded initialization wait and a deterministic fallback.” A cached assignment must be scoped to the experiment and authenticated identity.

**Follow-up:** Rendering control immediately and switching to treatment later contaminates exposure and looks unstable. Distinguish “configuration loaded,” “assigned,” and “actually exposed.” Record fallback behavior so SDK failures do not silently bias the experiment population.

### 1.3 How did variants integrate with React?

**Sample:** “A provider exposed stable experiment decisions through a hook such as `useExperiment('dashboard-layout')`. The container selected control or treatment, while business logic and authorization stayed outside the experiment. We did not call random assignment during rendering.”

**Alternatives:** Server-provided props are simple when assignment already exists in bootstrap data. A wrapper component can centralize loading/fallback behavior. A hook is flexible but should not create a new SDK client in every component.

**Follow-up depth:** Exposure logging must tolerate remounts, route changes, and development Strict Mode behavior. Define whether exposure is counted once per experiment/user or once per encounter, then deduplicate accordingly. Do not log an impression merely because a hidden component mounted or a flag was evaluated for an unrelated purpose.

### 1.4 Which analytics tool captured the metric?

**Sample:** “We used [actual analytics system] with explicit experiment-exposure and activity events. I verified the metric’s definition rather than assuming the vendor’s default session-duration chart matched our goal.” Amplitude, Mixpanel, PostHog, GA, or an internal warehouse are alternative answers, not interchangeable names.

Explain session boundaries, inactivity timeout, visible versus background time, and whether an open tab with no interaction counts. Heartbeats can estimate active time, but use a consistent definition and avoid crediting hidden or idle tabs. The last event timestamp can underestimate the final page’s duration.

**If GA:** Google states that Google Analytics must not receive PHI and does not offer a BAA for Analytics. Do not claim an authenticated healthcare workflow became safe merely by excluding a `patientName` field. Any approved use on a separate public surface must be evaluated on its actual data flows. [Google’s HIPAA and Analytics guidance](https://support.google.com/analytics/answer/13297105?hl=en).

### 1.5 What statistical analysis did you use? What about skew?

**Python path:** “I computed the prespecified effect estimate and confidence interval using [actual method]. I inspected the heavy tail in duration and accounted for repeated sessions from the same assigned user.” SciPy or statsmodels are tools; name the test and experimental unit, not just the language.

**Reasonable alternatives:** A Welch comparison of independent unit-level averages can be reasonable with sufficient data; large-sample behavior matters more than assuming raw durations are normally distributed. A cluster bootstrap resamples assigned users or accounts with all their sessions, preserving dependence. For a session-weighted mean, recompute total duration divided by total sessions in each resample; averaging user means answers a different question. [SciPy bootstrap documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html).

**Vendor/R path:** Explain the vendor’s inference framework or the actual R procedure. A Bayesian result needs its prior and decision rule; it does not eliminate data requirements. Log-transforming duration changes the estimand, and Mann–Whitney is not simply a test of arithmetic means. Predefine outlier handling and a stopping rule; repeated unadjusted significance checks inflate false positives.

### 1.6 Did experimentation and analytics vendors sign a BAA?

**If verified:** “Security/privacy and procurement approved the vendor for the specific service and data flow. My responsibility was to implement the approved collection boundaries.” A BAA is one part of the arrangement, not a blanket compliance certification.

**If not verified:** “I did not own the vendor agreement, so I would not claim its terms. I can explain the data we collected and the controls I implemented.” If a vendor handled PHI on behalf of a regulated entity as a business associate, the applicable permission and BAA requirements mattered. [HHS tracking guidance](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/hipaa-online-tracking/index.html).

For a no-PHI design, explain review of automatic metadata, URLs, identifiers, SDK behavior, and network destinations. Removing names alone does not establish de-identification. The engineering answer is documented data-flow evidence, not an absolute guarantee based on one code review.

### 1.7 How did you enforce that no PHI entered events?

**Proposed answer, if implemented:** “Application code emitted typed events through one approved wrapper. Each event had an allowlist of field names, types, and permitted values. The ingestion service rejected unknown fields. We avoided free text, raw URLs, request bodies, and patient identifiers.”

**Layered controls:** TypeScript catches developer mistakes but not runtime objects or bypasses. Add runtime schema validation, tests for forbidden payloads, a lint/import rule discouraging direct SDK use, and reviews of automatic capture settings. A first-party collector can provide a further filtering boundary before forwarding.

**Follow-up:** Test outbound payloads, not only wrapper functions. SDK autocapture, session replay, breadcrumbs, and error attachments may create separate channels. Use route templates rather than resource-specific URLs. Document how a rejected event is counted without copying its sensitive contents into an error log.

### 1.8 What targeting attributes did you send?

**Sample:** “Targeting used the minimum approved attributes, such as a coarse application role and a non-patient experiment identifier. Whenever feasible, sensitive eligibility checks ran internally, and the external service received only the resulting decision context.”

**Important distinction:** Random or hashed identifiers can still be linkable to a person. Hashing an email, medical record number, or account ID is not automatically HIPAA de-identification. Even seemingly harmless attributes can become identifying when combined.

**Alternative:** Resolve the entire assignment on the server and send only `experimentId` and `variantId` to the browser. Explain whether randomization was at employee, account, organization, or patient level. Those units have different privacy and statistical implications. Do not say you targeted patients if the application was used by operational staff and that is all you know.

### 1.9 SDK keys are visible. Can users see or force variants?

**Sample:** “Browser SDK credentials were limited public/client identifiers, not server administration credentials. I assumed users could inspect shipped JavaScript, configuration, and local variant decisions. Experiment assignment was never an authorization boundary.”

Users may manipulate browser state or replay requests; that must not expose protected data or privileged operations. Internal QA overrides should be controlled and their traffic excluded from analysis. Do not ship confidential upcoming product details merely because the UI normally hides them.

**Follow-up:** If assignment affects pricing, eligibility, or a business entitlement, the server must decide and validate that outcome. A browser flag can influence presentation but cannot be trusted as evidence of permission. Suspected assignment tampering is also an experiment-quality issue, separate from access control.

### 1.10 Could a variant expose a feature to the wrong role?

**Sample:** “We first evaluated whether the user was entitled to the capability, then applied the experiment within that authorized population. Each backend operation independently enforced tenant, role, and resource permissions.”

For example, treatment may reorganize an already authorized workflow, but it cannot grant access to another tenant’s records. A disabled button is a usability affordance; the protected endpoint must deny the same action when invoked directly.

**Tests to discuss if performed:** Every relevant role in both variants; manually forced variant state; cross-tenant object IDs; permissions revoked mid-session; protected export or drill-down actions. A shared authorization function can reduce inconsistent checks, but test both REST and any streaming subscription because the transports have separate entry points.

### 1.11 How did you prevent flicker? What did anti-flicker cost?

**Preferred design explanation:** “We made the assignment available before rendering the experiment area. The rest of the shell could render normally. That avoided showing one experience and immediately replacing it.”

**If an anti-flicker snippet was actually used:** Explain its scope, timeout, and failure fallback. Hiding the whole document can delay visible content and LCP. A bounded placeholder for one region can have a smaller impact, though it can still delay that region’s meaningful paint.

**Measurement:** Compare assignment-ready time, FCP/LCP, layout shifts, timeout rate, and exposure counts across variants under slow-network conditions. Do not say anti-flicker was “free” because its script was small: the principal cost can be waiting for a remote decision.

### 1.12 How big was the SDK, and did it block rendering?

**When you have the measurement:** “The SDK added [measured compressed bytes] to the [initial/deferred] path in our production build. We also measured initialization requests and main-thread cost.” Report the package version and measurement boundary.

**When you do not:** “I do not remember the exact size. I would verify it from the production bundle report; package download size is not the same as shipped JavaScript.”

Initialize a shared client once, limit requested configuration, and avoid unnecessary analytics integrations. An asynchronously loaded SDK avoids parser blocking, but rendering can still wait on its decision. Explain that dependency separately. Define what happens if initialization is slow or fails, including whether users enter the experiment at all.

### 1.13 Were both variants shipped? Did you split them?

**Small-change path:** “For a small layout variation, both branches shared most components, so additional splitting would have added complexity with little byte savings.”

**Heavy-variant path:** “We used dynamic imports for the expensive variant-only module. The assignment was resolved early enough to request the selected module, with a suitable loading boundary.” Shared modules still belong in sensible common chunks.

**Follow-up:** Deferred bytes are not deleted bytes. Both implementations may exist in the deployment while only one is initially downloaded. Loading a treatment chunk later can alter perceived responsiveness and experiment results, so include chunk-fetch timing in the analysis. After deciding the winner, remove obsolete branches and configuration so the experiment does not leave permanent bundle overhead.

### 1.14 Could load-time differences explain the duration change?

**Sample:** “Yes. I would compare route load time, interaction delay, errors, and active versus idle duration between arms. Longer elapsed time can reflect waiting, retries, or confusion.”

If a randomized treatment itself made the page slower, that performance change is part of the treatment effect; it is not automatically an external confounder. The problem is interpreting that effect as valuable engagement. Also verify that one variant did not fire extra heartbeats or different session-end events.

**Useful supporting evidence:** Improved completion rate, stable or lower task time for the core operation, more voluntary use of useful features, and stable abandonment. If only duration was measured, a defensible answer is: “The observed result was increased duration; I cannot infer improved task efficiency from that alone.”

### 1.15 How many experiments ran concurrently? Interaction effects?

**Historical answer:** State the number only if remembered. “I owned [experiment]; I did not administer the entire experiment portfolio” is acceptable when true.

**Design answer:** Experiments changing the same workflow can use mutually exclusive layers. Experiments on plausibly independent surfaces may overlap with separately salted assignment, provided exposures are recorded and interaction risk is reviewed. Overlap itself is not always invalid.

Two experiments may affect each other: a navigation change can alter who sees a dashboard experiment. For major expected interactions, use a planned factorial design or separate the tests. More combinations require more data. A registry should show owners, affected surfaces, targeting, primary metrics, and scheduled dates so teams can detect conflicts before launch.

### 1.16 Low B2B traffic: how did you reach significance? What MDE?

**Sample:** “We planned sample size using the baseline variability, assignment unit, desired power, significance level, and minimum detectable effect. We ran through representative business cycles and accepted that some tests could remain inconclusive.”

**Illustrative calculation:** For independent units with standard deviation 4 minutes and a target difference of 1.5 minutes, a rough equal-arm normal approximation at two-sided 5% significance and 80% power gives `n ≈ 2 × (1.96 + 0.84)² × 4² / 1.5² ≈ 112` units per arm. This is a teaching example, not your experiment’s sample size. Heavy tails, clustering, unequal groups, and attrition change the requirement. [statsmodels power parameters](https://www.statsmodels.org/stable/generated/statsmodels.stats.power.TTestIndPower.solve_power.html).

More sessions from the same few accounts do not create equivalent independent sample size. Do not lower rigor until a result appears significant. Detect a larger effect, improve the metric, run longer when feasible, or report uncertainty.

### 1.17 How did assignment remain consistent across devices and sessions?

**Authenticated path:** “We keyed assignment to a stable internal user or account identity with an experiment-specific salt. Each session retrieved the same assignment.” For example, a deterministic hash maps `experimentId + assignmentUnitId + salt` into a bucket range.

**Anonymous path:** A first-party browser identifier supports consistency only within that browser until storage disappears. It cannot promise cross-device consistency. When anonymous users authenticate, define whether to preserve the existing assignment or start the authenticated population separately.

**Follow-up:** Changing allocation boundaries or salts can move users between variants. Preserve enrolled assignments when needed and version changes deliberately. Tenant-level assignment avoids coworkers seeing conflicting workflow behavior but reduces the number of independent experimental units.

### 1.18 What event volume did this generate? Did you sample?

**Answer structure:** “Volume was approximately eligible users × sessions per user × events per session, plus heartbeat traffic. We measured ingestion peaks and delivery failures.”

**Illustrative example:** 2,000 active users × 4 sessions × 15 events produces 120,000 events/day before heartbeats. This is a capacity example, not a claim about your system. Browser events also need bounded batching, deduplication IDs, and a delivery policy for page exit or offline periods.

Keep essential assignment/exposure/outcome events complete where feasible. Sample noisy diagnostics independently, or use a prespecified unit-level sampling design with known probabilities. Sampling only long sessions, successful submissions, or one treatment arm biases estimates. Never claim “we sampled 10%” without explaining what was sampled and how the analysis handled it.

### 1.19 How did you prevent flag and experiment debt?

**Sample:** “Every experiment had an owner, purpose, start date, expected decision date, and cleanup task. After rollout, we removed the losing branch, old tests, unused events, and expired configuration.”

Separate short-lived experimental flags from longer-lived operational kill switches and entitlements; they have different lifecycles. Deleting a flag without changing a default value can accidentally reverse a rollout, so cleanup should be coordinated with code deployment and supported client versions.

**At scale:** Track stale flags, last evaluation time, affected repositories, and overdue owners. A dashboard is useful only if a team is accountable for cleanup. Include archived experiment results so later teams understand the decision rather than rerunning the same test unknowingly.

### 1.20 How would you design a platform for ten teams?

**Proposed architecture:** “I would provide a shared assignment service or approved SDK layer, a versioned event contract, an experiment registry, and a standard analysis pipeline. Teams would own hypotheses and implementation; a small platform function would own correctness, reliability, and privacy boundaries.”

The registry needs targeting, assignment units, overlapping-surface review, owners, stopping rules, and rollback. The data pipeline needs schema validation, deduplication, late-event handling, sample-ratio-mismatch checks, and metric definitions. Sample-ratio mismatch means actual allocations deviate unexpectedly from planned proportions and may indicate a broken experiment.

Use role-based configuration access, change history, environment separation, and a reliable fallback when configuration is unavailable. Provide a launch checklist and analysis template rather than allowing ten incompatible implementations. Keep patient data outside experimental telemetry unless an explicitly approved design requires it.

**Defending the 30%:** Relative uplift is `(treatment − control) / control × 100`. An illustrative change from 5.0 to 6.5 minutes is 30%, or +1.5 minutes. State the actual baseline, unit, dates, sample size, confidence interval, and guardrail results if known. A before/after comparison alone is weaker causal evidence than a well-run concurrent randomized experiment.

## 2. Real-time analytics dashboards — REST, WebSocket, D3; 25% lower refresh latency

**Opening answer template:** “I built React dashboards with D3 visualizations. REST provided [initial snapshots/history], and WebSocket carried [actual live update type], replacing reliance on polled snapshots. I owned [frontend integration, chart updates, reconnection, or other actual scope]. The measured data refresh latency decreased 25%. The important design problem was keeping the view current without making the browser process and redraw the entire dataset for every event.”

### 2.1 Which charting library? With D3, who owned the DOM?

**Confirmed tool: D3. Choose the integration you actually used.**

**Path A — React owns SVG:** “D3 calculated scales, domains, ticks, and path geometry; React rendered the SVG elements. That kept DOM ownership in one place and made chart state flow through props.”

**Path B — D3 owns a bounded subtree:** “React rendered a container and ref. D3 managed only the children inside that container, using effects for updates and cleanup.” React should not simultaneously reconcile the exact nodes that D3 mutates. Both approaches are valid. [D3’s React integration guidance](https://d3js.org/getting-started).

For a D3-managed subtree, explain keyed joins: a stable series or point ID lets existing nodes update, new nodes enter, and removed nodes exit. Avoid deleting and recreating the whole SVG for each message. [D3 data joins](https://d3js.org/d3-selection/joining).

**Other branches for comparison:** Recharts makes common SVG charts convenient but still requires bounded data. Chart.js supports updating a retained instance and skipping animations for frequent updates. Highcharts requires appropriate licensing approved by the organization; do not invent the approver. [Chart.js updates](https://www.chartjs.org/docs/latest/developers/updates.html).

### 2.2 Native WebSocket or Socket.IO? Reconnect, heartbeat, backoff?

**Native path:** “We had a connection manager with connecting, live, reconnecting, and closed states. Unexpected disconnects scheduled exponential backoff with jitter. On reconnection, we authenticated, restored permitted subscriptions, and resynchronized missed data.” Stop retries on logout and distinguish transient failures from invalid credentials.

Browser JavaScript does not expose protocol-level ping/pong controls; an application heartbeat can carry a timestamp or sequence number if the protocol requires it. A missed-heartbeat deadline detects half-open connections. Only one reconnect timer and one active socket should exist per intended connection.

**Socket.IO path:** Its reconnection, acknowledgments, and room model can reduce custom plumbing when the backend already uses it. The tradeoff is a Socket.IO-specific protocol and matching server infrastructure. Neither choice automatically guarantees replay or exactly-once delivery. Explain your application’s sequence IDs, deduplication, and resync behavior independently of the library.

### 2.3 Why WebSocket instead of SSE? What went upstream?

**If bidirectional behavior existed:** “Clients sent subscription changes, filter scopes, acknowledgments, or interactive commands over the connection, while the server pushed updates. A bidirectional channel matched that protocol.” Name only messages your client actually sent.

**If updates were one-way:** “SSE would also have been a reasonable choice. We used WebSocket because [existing backend protocol or actual constraint].” Do not invent bidirectional requirements merely to justify the original architecture. REST requests can accompany SSE for occasional client commands.

**Tradeoff:** SSE is a text event stream over HTTP with browser reconnection behavior; WebSocket supports bidirectional messaging and binary payloads. Both still need authentication, reconnect correctness, proxy configuration, and a strategy for missing events. “Real-time” by itself does not select one transport.

### 2.4 Where did live state live? How were pushes merged?

**Redux path:** “Normalized entities lived in a Redux slice keyed by stable IDs. Incoming messages were buffered and applied in batches, and components selected only the entities or aggregates they needed.” One dispatch per packet may create excessive reducer and subscription work even when React batches some rendering.

**React Query/TanStack Query path:** Apply immutable updates through `queryClient.setQueryData` to the correct query key, including tenant and filter scope. Reject older versions. If a change affects pagination or filtering in a way the client cannot safely reconstruct, invalidate and refetch. [Query cache update guidance](https://tanstack.com/query/latest/docs/framework/react/guides/updates-from-mutation-responses).

**Zustand/Context/custom path:** A store with narrow subscriptions can work. A single high-frequency Context value often causes broad rerenders. Whichever tool was used, define one source of truth; independently storing the same entities in Redux, query cache, and chart state creates synchronization bugs.

### 2.5 Which table library? Did you use live transactions?

**AG Grid path:** State Community or Enterprise only if known, then tie the choice to actual features. Incremental transactions add, update, or remove identified rows without resetting all data; stable row IDs help preserve selection. High-frequency feeds may benefit from batching transactions. [AG Grid transaction updates](https://www.ag-grid.com/javascript-data-grid/data-update-transactions/).

**TanStack Table path:** It provides table state and models; you supply rendering and, when needed, a separate virtualization solution. **MUI DataGrid path:** Describe its row-update and virtualization behavior for the actual edition/version. **Custom table path:** Explain its deliberately limited feature scope rather than claiming an unneeded grid library.

D3 being confirmed for charts does not identify the table library. If the dashboard did not contain a substantial table, say that this branch did not apply.

### 2.6 How was the socket authenticated? Query token or cookie?

**Cookie/session path:** “The server authenticated the session and checked the handshake Origin against an explicit allowlist.” Cookie attributes and session validation matter; cookie authentication alone does not prevent cross-site WebSocket hijacking.

**Token path:** A browser’s native WebSocket constructor cannot simply attach an arbitrary `Authorization` header. Possible designs include a short-lived single-use connection ticket obtained over HTTPS, or a first message that authenticates before any subscriptions/data are allowed. Bound unauthenticated connections by time and resources.

**If a query token was used:** Acknowledge log exposure risk. Explain token scope, lifetime, single-use semantics if present, and redaction at proxies and application logs. Do not claim “TLS makes query tokens safe in logs.” [OWASP WebSocket security guidance](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html).

### 2.7 How did you handle token expiry on hours-long connections?

**Reconnect path:** “Before the credential expired, the client renewed authentication and established a new authorized connection, then resumed from a cursor or fetched a fresh snapshot.”

**In-band path:** “The protocol supported a reauthentication message. The server validated the new credential and updated the connection’s authorization context.” Do not describe in-band refresh unless the server actually supported it.

In both cases, the server must have its own expiry policy; an open connection is not perpetual authorization. Failed renewal should stop delivery and clear protected state. Account disablement or permission revocation may require invalidation beyond ordinary expiry. Avoid a reconnect loop that repeatedly presents the same invalid token.

### 2.8 Was authorization checked per subscription or only at connect?

**Sample:** “Connection authentication established identity. Subscription authorization determined which tenant, resource, or channel that identity could receive. The server derived allowed scopes rather than trusting a tenant ID supplied by the browser.”

For ongoing delivery, use a design that respects policy changes: short-lived authorization decisions, explicit revocation events, or rechecking relevant permissions. Merely knowing a channel name must not grant membership. This is the message-level access-control distinction emphasized by [OWASP’s WebSocket guidance](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html).

**Concrete interview example:** Changing a subscription payload from tenant A to tenant B should be rejected server-side. Likewise, revoking a user’s access should remove or stop the affected subscription. Frontend filtering after receiving unauthorized records is too late; the disclosure already occurred.

### 2.9 Did dashboards display PHI? How did masking help?

**If aggregate-only:** “The dashboard presented operational aggregates, and record-level details were exposed only through separately authorized workflows,” if true. Aggregates still require privacy review where very small groups can identify individuals.

**If PHI was displayed:** “We returned only fields needed for the task, restricted access by role and resource, and used masking for sensitive values when full display was unnecessary.” Masking reduces casual screen exposure, but does not protect raw values already delivered to the browser.

For stronger protection, have the server return masked values unless a separately authorized reveal is requested. Consider clipboard/export paths, tooltip text, accessibility labels, print views, and session replay. Inactivity locking and a clear stale-data indicator can help in shared operational environments, subject to actual product requirements.

### 2.10 Could a malicious patient name cause XSS in chart labels?

**D3-specific answer:** “Untrusted strings were inserted as text. With D3 I would use `.text(...)`, not concatenate them into `.html(...)`. With React I would use normal text rendering. Tooltips were included in the review because they often bypass the main component renderer.”

If rich HTML was a real requirement, sanitize with an approved, maintained sanitizer and a narrow policy. Also validate URLs and avoid dangerous event-handler attributes; text escaping alone does not make arbitrary URL schemes safe.

**Useful test:** A synthetic label containing HTML-like text should appear literally and execute nothing. Review third-party tooltip formatters, export templates, and embedded links. “React escapes text” is insufficient when D3 or a chart plugin writes raw HTML outside React.

### 2.11 How did you avoid a rerender for every message?

**Sample:** “The socket handler validated incoming events and placed them in a bounded buffer. A scheduler applied a batch of state changes, and only affected widgets updated.”

**Scheduling alternatives:** `requestAnimationFrame` aligns visual work with frames but can still be too frequent for expensive charts. A fixed interval, such as an illustrative 100–250 ms, trades a small freshness delay for lower CPU. A buffer-size threshold plus a maximum wait bounds both memory and latency. Choose based on measured responsiveness, not a universal interval.

Coalesce by entity only when an event represents replacement state. Dropping intermediate increments or ordered financial/clinical events can corrupt results. React’s automatic batching does not eliminate JSON parsing, reducer work, chart geometry calculation, or all work across separate message callbacks.

### 2.12 SVG versus Canvas: when did volume matter?

**D3 answer:** “D3 was the visualization toolkit; SVG or Canvas was the rendering choice. I evaluated visible element count, update frequency, interactions, and device performance.” Thousands of individual SVG nodes can become expensive, but one SVG path representing many points is a different workload.

**SVG:** Convenient per-element interaction, styling, and inspection. **Canvas:** Often useful for dense, frequently redrawn marks, but requires manual hit testing and an accessibility alternative. D3 can supply scales and geometry for either approach.

There is no credible universal cutoff such as “Canvas after exactly 1,000 points.” Benchmark representative data. Downsample to the available pixel width, preserve important extrema, limit the live window, and offer an accessible textual summary or table where needed.

### 2.13 Did you virtualize tables? How did live updates interact?

**Sample:** “We rendered only visible rows plus overscan using [actual library]. Records had stable IDs, so a live update changed the record rather than replacing its identity.”

Virtualization reduces mounted DOM nodes, not necessarily the full in-memory dataset or sorting/filtering cost. If every update changes sort order, the viewport can jump even with perfect virtualization. Consider batching reorder operations, preserving a scroll anchor, or showing a ‘new updates available’ affordance while the user inspects a row.

**Follow-up:** Track focus and selection by row ID, not array index. Variable-height rows need careful measurement invalidation. Test rapid updates while scrolling, editing a row, or using keyboard navigation. For very large datasets, combine virtualization with server-side pagination/filtering rather than loading everything into memory.

### 2.14 How did you prevent memory growth over eight hours?

**Sample:** “We bounded the retained time window and number of points, removed obsolete entities, and cleaned up subscriptions, event listeners, timers, and chart resources when a view unmounted.”

D3 transitions and external tooltip nodes can survive careless remounts. Reconnection logic can also leak duplicate handlers or sockets. A ref holding every historical packet is still a leak from the product’s perspective even if the garbage collector works correctly.

**Verification:** Compare heap snapshots after repeated mount/unmount cycles and after a sustained realistic event feed. Inspect retained objects, detached DOM nodes, socket counts, and timer/listener growth. Memory may fluctuate with garbage collection; the warning sign is sustained retained growth for a bounded workload, not every short-term heap increase.

### 2.15 What happened in background tabs?

**Sample:** “We used document visibility to reduce expensive rendering. Depending on the dashboard’s requirements, we either retained a bounded latest state or reduced the subscription rate, then refreshed authoritative data when the tab became visible.”

Pausing chart drawing alone does not stop incoming network traffic or memory growth. Browser timers and animation callbacks may be throttled in the background, so a queue drained only by animation frames can grow without an explicit cap.

**Correctness:** On return, check the last update time and sequence continuity. Fetch a snapshot when replay is unavailable or a gap occurred. Do not silently show an old chart as live. Operational alerts may need a different background-delivery policy from a routine analytics graph.

### 2.16 Peak connections and server count?

**Historical answer:** “The peak was [verified number] connections across [verified count] instances.” If unavailable: “I owned the frontend integration and do not want to guess the backend capacity. The capacity measures I would examine are active connections, subscriptions, outbound bytes, event-loop lag, memory, and reconnect rate.”

**Illustrative sizing:** 5,000 clients receiving two 1 KB messages per second require about 10 MB/s of application payload before protocol, TLS, and replication overhead. A client subscribed to ten busy channels behaves differently from an idle connection.

Load tests should include realistic subscription distribution, slow readers, reconnect bursts, and instance failure. “One server supports N sockets” is incomplete without message rate, payload size, resource limits, and the required latency target.

### 2.17 How did the backend fan out messages?

**Possible architecture:** “Domain updates entered an event pipeline. A gateway consumed relevant events and delivered them to authorized subscribers connected to that gateway.” State whether you observed or implemented this; do not claim backend ownership from frontend integration alone.

**Redis Pub/Sub:** Useful for transient broadcast, but subscribers can miss messages while disconnected. **Kafka:** Useful for a durable ordered log within partitions and replay, but consumer-group topology needs care. Multiple gateways in one consumer group divide records; they do not each automatically receive every record their clients might need.

**Follow-up:** Explain routing by tenant/topic and a snapshot or replay path for gaps. Avoid broadcasting every event to every gateway if subscriptions are sparse. The message bus, gateway routing, and browser recovery protocol solve different problems.

### 2.18 Were sticky sessions needed across WebSocket servers?

**Native WebSocket:** An established connection stays with the server handling that connection. Ordinary application-level stickiness is not required simply to keep its frames together. Reconnect may land on another server, which must reconstruct authentication and subscriptions.

**Socket.IO with HTTP long-polling:** Multiple HTTP requests for one transport session generally require affinity unless an alternative synchronization design exists. WebSocket-only Socket.IO avoids that polling requirement, at the cost of losing the polling fallback. A cross-node adapter is a separate concern for broadcasts. [Socket.IO multi-node documentation](https://socket.io/docs/v4/using-multiple-nodes/).

**Interview nuance:** A deployment may still choose stickiness for other stateful application reasons. Explain the actual transport and state ownership rather than saying either “WebSockets always need sticky sessions” or “sticky sessions are never necessary.”

### 2.19 What if a slow client cannot keep up? Backpressure?

**Sample:** “We defined bounded queues and a policy for lagging clients. For replaceable dashboard state we could coalesce to the latest value. For ordered events we required replay or resynchronization rather than silently discarding data.”

The standard browser WebSocket API has no incoming backpressure mechanism. `bufferedAmount` reports queued outbound data, not how far behind the browser is in processing received messages. Application-level acknowledgments, sequence lag, rate negotiation, or disconnection/resync can provide control. [MDN WebSocket documentation](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket).

**Practical policy:** After a queue threshold is exceeded, mark the view stale and request a fresh snapshot, or close with a documented recovery path. The server also needs per-client send limits so one slow connection cannot consume unbounded gateway memory.

### 2.20 What breaks first if users grow tenfold?

**Sample:** “I would measure before predicting. If only the number of users grows, gateway connections and fan-out bandwidth may dominate. If each client receives more data, browser processing and chart rendering may also become the bottleneck.”

Instrument pipeline lag, publish-to-gateway delay, gateway queue depth, network transit, client processing, and visible update latency. Separate slow production of data from slow delivery and slow rendering.

**Scaling plan:** Partition subscriptions, distribute gateways, batch/coalesce suitable updates, pre-aggregate high-cardinality series, and reduce unnecessary client subscriptions. Test reconnection storms and deploy drains, not just steady traffic. Preserve the snapshot-and-resume contract as components scale independently.

**Defending the 25%:** Define the latency interval. For example, source-update-to-visible-chart time is broader than message-received-to-state-update time. A hypothetical decrease from 4.0 to 3.0 seconds is 25% lower latency. Compare the same statistic and workload before and after. A 25% latency reduction is not mathematically the same as a 25% increase in refresh frequency.

**Snapshot/stream race follow-up:** REST bootstrap and live events need coordination. One design fetches a snapshot with a sequence cursor and replays events after it. Another subscribes and buffers first, fetches a versioned snapshot, then applies newer buffered events. In either design, reject duplicate/older versions and resync on a gap. Otherwise a late snapshot can overwrite newer live state.

## 3. Modular React architecture — reusable building blocks across workflows

**Opening answer template:** “I identified repeated interaction patterns across [actual workflows] and separated reusable components and hooks from workflow-specific rules. The shared layer handled [actual examples], while each feature supplied its own data, permissions, and orchestration. That reduced duplicated implementation without forcing unrelated workflows into one configurable component.”

Prepare two actual examples and explain what varied between their consumers. The résumé supports reuse across multiple workflows, but does not establish three teams, a monorepo, a published library, or a specific component framework.

### 3.1 MUI, Ant Design, an in-house library, or headless primitives?

**MUI/Ant Design path:** “We built product-specific components on the existing library. Global typography, spacing, colors, and standard component variants were configured centrally. Feature-specific behavior stayed in wrappers or composition rather than scattered overrides.” For MUI, favor supported theme/component APIs over brittle selectors into internal markup.

**Headless path:** “We needed custom presentation but wanted established interaction primitives. We composed accessible primitives with our styling and domain behavior.” Accessibility still needs verification in the assembled component.

**In-house path:** Justify the actual constraints: existing design system, specialized workflow behavior, or a deliberately small set of components. Building every dialog, combobox, and date picker from scratch creates keyboard, focus, localization, and maintenance work. Distinguish an internal business component library built on third-party primitives from a fully original primitive library.

### 3.2 CSS Modules, styled-components, Emotion, or Tailwind?

**CSS Modules:** Local class scope with ordinary CSS and little styling logic at runtime. **Tailwind:** Utility classes support consistency through configured tokens; reusable components prevent repeated long class combinations. Neither choice automatically guarantees a small stylesheet.

**Emotion/styled-components:** “Theme-aware styles and variants matched the existing stack. We avoided generating unnecessarily unique styles on every render and measured their effect in frequently updated views.” Runtime costs can include style calculation, serialization, and rule insertion, depending on the library and mode.

**Follow-up:** For continuously changing chart coordinates or dimensions, static classes plus bounded inline styles/CSS custom properties may be simpler than generating new style rules. Explain the actual project approach; do not attribute a styling choice to Change Healthcare solely because it is common in React applications.

### 3.3 Monorepo or private npm package?

**Single application:** A shared `components`/`hooks` area with clear imports may have been sufficient. This is a legitimate modular architecture; a package registry is not required for reuse.

**Monorepo:** Atomic changes across packages, workspace linking, and coordinated tests help when consumers share development and release practices. Nx, Turborepo, and Lerna are different tools with overlapping roles; name only the one actually used.

**Private package:** Independent applications consume versioned releases from a registry. This supports separate release schedules but requires compatibility policies, documentation, and updates by consumers.

**Design principle:** Distribution should follow ownership and release needs. Even in a monorepo, enforce public entry points rather than importing another package’s internal files. React should generally be a compatible peer dependency for a shared React library to avoid shipping conflicting copies.

### 3.4 TypeScript APIs: generics and discriminated unions?

**Generic example:** A table can accept `rows: T[]`, `getRowId: (row: T) => string`, and columns whose renderers receive `T`. This preserves the relationship between data and callbacks without hard-coding a particular business entity.

**Discriminated union example:** A load state can be `{status: 'loading'}`, `{status: 'error', message: string}`, or `{status: 'success', data: T}`. The compiler prevents a consumer from treating missing data as a successful result. Similarly, single-select and multi-select modes should expose different value/callback types.

**Sample answer:** “I used generics when consumers shared behavior over different data shapes, and unions when modes had different valid props. I avoided a large collection of booleans that allowed contradictory states.” TypeScript does not validate backend JSON at runtime; validate at the API boundary when needed.

### 3.5 Did you use Storybook? How did it fit?

**If used at this employer:** “Stories documented supported component states: default, empty, loading, error, disabled, permission-restricted, long content, and keyboard interactions. Reviewers could inspect the component without constructing the entire application state.”

Stories can support design review, accessibility checks, interaction tests, and visual comparisons, but only claim the checks actually configured. Use synthetic data and ensure documentation builds do not connect to production APIs or expose internal secrets.

**If not used:** “We documented examples in [actual method]. Storybook would be a reasonable improvement for independently reviewing shared states.” Your résumé lists Storybook elsewhere, which establishes familiarity but not automatic use at Change Healthcare. The important interview point is how consumers discovered and understood the supported API.

### 3.6 Shared rich text and HTML sanitization?

**Default answer:** “Most components rendered plain text. Any actual HTML-rendering requirement was isolated behind a reviewed component instead of allowing arbitrary consumers to pass HTML directly.”

**If `dangerouslySetInnerHTML` existed:** Explain the trusted boundary, sanitizer, allowlisted tags/attributes, URL handling, and update policy. DOMPurify is one possible maintained sanitizer, not a guarantee that every surrounding operation is safe. Do not modify sanitized markup afterward with unsafe string concatenation.

**Alternative:** Parse supported content into a constrained React representation rather than allowing general HTML. Security tests should include malformed markup, dangerous URLs, SVG-related edge cases where relevant, and sanitizer regressions. Server-side sanitization may also be required when content is reused in email or other clients; the browser component is not the only consumer.

### 3.7 Did components enforce permissions? Is hiding a button security?

**Sample:** “Shared components made the authorized UI consistent, for example hiding or disabling unavailable actions. The backend enforced permission on every protected read or mutation. I treated the UI check as a usability feature.”

Pass a resolved capability or use a shared authorization adapter rather than scattering role-string comparisons. Roles are often too coarse: tenant, resource ownership, workflow state, and assigned responsibilities may matter.

**Follow-up example:** A user can invoke an endpoint after modifying client state. That request must still fail if unauthorized. Test the server boundary and verify that the frontend handles a later 403 gracefully when permissions change after the page loaded. Do not reveal protected fields merely because the action button was hidden.

### 3.8 Did you build PHI masking components?

**If yes:** “We standardized display rules for approved sensitive fields, including masked defaults and an authorized reveal interaction where required.” Explain actual fields; do not add SSNs to your project story unless they were present.

A masked component must consider tooltip content, `title` attributes, accessibility text, copy actions, exports, and analytics. Rendering the full value off-screen or hiding it with CSS can still expose it to assistive technology, DOM inspection, and screenshots under some styles.

**Boundary:** If the user should never access the full value, the server should not send it. If reveal is legitimate, request it through an authorized endpoint and apply the actual audit policy. A shared mask component centralizes presentation; it does not decide legal access by itself.

### 3.9 How were third-party dependencies vetted?

**Sample:** “We considered maintenance, license compatibility, known vulnerabilities, package origin, transitive dependencies, and whether the functionality justified another dependency. CI scanning and automated update tooling helped identify changes requiring review.” Name npm audit, Snyk, Dependabot, or another tool only if used.

Automated scanners have blind spots: a package can be malicious without a known CVE, or have a vulnerability in an unused path that requires careful triage. Review lockfile changes and unexpected installation scripts, and use the organization’s registry and provenance policies.

**Follow-up:** Prefer a small, well-understood dependency footprint, but do not rewrite complex security-sensitive functionality casually to avoid dependencies. Record owners and patch expectations so a shared component’s dependencies do not become nobody’s responsibility.

### 3.10 How did you limit the impact of a vulnerable shared component?

**Sample:** “We reduced risk through narrow APIs and reviewed primitives, then maintained a way to identify every consumer and release a fix quickly. Shared code increases the potential reach of a defect, so distribution and response matter as much as initial review.”

Use supported-version policies, dependency inventories, regression tests for the vulnerability, and automated consumer upgrade PRs where available. A canary rollout can catch compatibility problems before broad adoption. Serious vulnerabilities may require an expedited update or disabling the affected feature.

**Candid limit:** You cannot guarantee that one vulnerable shared component affects no applications. Isolation, least privilege, CSP, and safe server boundaries can reduce exploitability, while ownership and release discipline reduce the duration of exposure. Avoid claiming version pinning alone solves the problem; it can preserve a vulnerable version indefinitely.

### 3.11 Where did React.memo help, and where was it wasted?

**Sample:** “I profiled frequent interactions and used memoization for expensive components whose props stayed stable, such as an unchanged chart panel or repeated row. I avoided treating `memo` as a blanket fix.”

Fresh object, array, or callback props can defeat the default shallow comparison. Stable data references and focused props often help more than adding a custom comparator. A deep comparison may cost more than rendering and can introduce stale callback bugs if it ignores a meaningful prop.

Memoized components still rerender for their own state and consumed context changes. `useMemo` caches a computed value; `useCallback` preserves a function identity; neither is a correctness mechanism. Discuss the project’s actual React version instead of importing current compiler behavior into a 2023–2024 explanation. [React memo reference](https://react.dev/reference/react/memo).

### 3.12 Did you split Contexts?

**Sample:** “We separated values with different update patterns, such as stable theme/auth configuration and frequently changing feature state. Components subscribed only to the context they needed.”

A single provider carrying theme, user, filters, live data, and transient form state can cause broad updates whenever any part changes. Splitting state and dispatch contexts is useful when some consumers only issue actions. Memoizing a provider value helps avoid changes caused only by parent recreation, but cannot prevent updates when the underlying value actually changes.

For a high-frequency entity feed, a store with selectors can be more suitable. Do not create dozens of contexts reflexively: start with ownership and update frequency, then verify the benefit using the profiler.

### 3.13 Was the library tree-shakable? ESM and sideEffects?

**Sample:** “The distribution preserved ES modules and offered clear public entry points. We checked the consumer’s production bundle to confirm unused components were removed.” Source code using `import` syntax is not sufficient if the published build converts everything to a format that prevents effective elimination.

`sideEffects` describes whether importing a module performs necessary work; it is not a universal ‘make it smaller’ switch. CSS imports and registration modules may need explicit exceptions. Incorrectly setting everything to side-effect-free can remove required styling or setup. [Webpack tree-shaking guidance](https://webpack.js.org/guides/tree-shaking/).

**Verification:** Build a small consumer that imports one component and inspect its output. Watch for top-level imports that eagerly pull in charting, date, or editor packages even when their components are unused. For an internal folder rather than a published library, inspect the application build directly.

### 3.14 How did components perform in large lists and forms?

**Lists:** Stable keys, narrow row props, efficient selectors, and virtualization where appropriate. Avoid expensive formatting, sorting, or validation in every row render. Remember that virtualization does not remove computation performed before rendering.

**Forms:** Keep field state local or use field-level subscriptions. A keystroke in one field should not force every unrelated field and summary panel to rerender. Debounce expensive remote checks when product behavior permits, but keep immediate local feedback understandable.

**Follow-up:** Controlled inputs are not inherently too slow, and uncontrolled inputs are not automatically better. Measure real forms. Test error-heavy states, long labels, locale changes, keyboard focus, and screen readers. Generic abstractions should expose escape hatches for special behavior without making common cases difficult.

### 3.15 Versioning and breaking changes: semver, changesets, codemods?

**Package path:** “We classified API changes, documented releases, and used semantic versions. Breaking changes included behavior, styling, and accessibility changes that consumers depended on, not only TypeScript signature changes.” Changesets or another release tool can capture intent if actually used.

**Migration:** Deprecate old APIs when feasible, provide examples, and use codemods for repeatable transformations. A codemod cannot infer every business-specific behavior change, so affected consumer tests still matter.

**Monorepo/single-app alternative:** Coordinated changes can be committed atomically, but still need clear ownership and tests across consumers. Do not claim package semver if the components were simply shared within one application. The underlying goal is predictable change, not using a particular release tool.

### 3.16 How many teams and workflows consumed the library?

**Answer format:** “It was reused in [verified workflows], including [example A] and [example B]. My contribution was [components/hooks and adoption work].” Separate distinct workflows from distinct repositories, products, or teams; those are not equivalent counts.

If exact team count is uncertain, state the workflows you personally supported. Demonstrate reuse by explaining what was shared and what remained specific. For example, a loading/error shell and filter control might be shared while query construction and business validation remain per feature—only use this example as history if it matches your work.

**Evidence:** Import usage, component documentation, PRs, and consumer feedback are stronger than saying “used everywhere.” No consumer count is supplied by the résumé, so avoid rehearsing an invented number.

### 3.17 Who decided what entered the shared library?

**Sample:** “We looked for stable repetition across real consumers, a clear owner, and an API that expressed the shared behavior without absorbing every workflow’s rules.”

A proposed component should identify the consumer problem, supported states, accessibility needs, performance expectations, and migration cost. Avoid premature generalization after one feature and avoid blindly enforcing a universal ‘three uses’ rule when security or accessibility consistency already justifies sharing.

**Governance options:** A lightweight design review and maintainers may suffice for a small team; a larger organization can use a short RFC for broad API changes. Governance should make decisions and ownership clear without requiring a committee meeting for every small bug fix.

### 3.18 How did you keep consumers current?

**Sample:** “We made upgrades predictable through small releases, useful change notes, tested migration paths, and visible ownership for each consumer.”

Automated dependency update PRs can reduce manual work, but an opened PR is not adoption. Track versions actually deployed, prioritize security fixes, and distinguish supported release lines from obsolete versions. A private package can otherwise accumulate many incompatible consumers.

**Alternative in a monorepo:** Atomic updates and affected-consumer CI reduce version drift. Independent deployment still matters: source changes reaching the default branch do not prove every application is running them. For difficult upgrades, supply a deprecation window and migration assistance rather than repeatedly breaking consumers without warning.

### 3.19 Did design tokens help theming scale?

**Sample:** “We centralized semantic tokens such as surface color, text color, spacing, typography, radius, and focus styling. Components consumed semantic names so product themes could change consistently.”

Distinguish raw palette values from semantic intent. For example, a token meaning ‘critical action’ is more useful than hard-coding a particular red throughout the library. Tokens can be exposed through CSS custom properties, a theme object, or generated platform-specific outputs.

**Follow-up:** Theming also needs contrast checks, focus visibility, dark-mode testing, and density behavior. Tokens do not automatically make inaccessible color combinations safe. Do not put PHI or customer secrets into a downloaded theme configuration; branding data and sensitive operational configuration have different boundaries.

### 3.20 What changes when twenty teams consume it?

**Proposed answer:** “I would invest in explicit ownership, a contribution model, a release/support policy, and consumer compatibility checks. At twenty teams, coordination and safe adoption become as important as the components themselves.”

Separate broadly useful primitives from specialized domain modules. Provide documentation, searchable examples, accessible defaults, performance budgets, and migration guidance. Establish maintainers with decision authority and contribution review responsibilities; a shared repository without funded maintenance is fragile.

Measure adoption, upgrade lag, recurring support issues, accessibility defects, and duplicated alternatives. Permit justified exceptions when a feature’s requirements differ. This architecture does not automatically require micro-frontends: shared components and independently deployed frontends address different organizational problems.

## 4. Testing standards — approximately 95% CI coverage; 20% fewer regressions

**Opening answer template:** “I established testing conventions across the code I owned using Jest and MochaJS, with approximately 95% [actual coverage dimension and scope] enforced through CI. I partnered with DevOps on the pipeline and emphasized realistic success, failure, and permission scenarios. Over [actual comparable periods], regression incidents decreased 20%. Coverage helped expose missing exercised code, while the behavior tests addressed the defects users experienced.”

### 4.1 Why both Jest and MochaJS? Why not migrate everything?

**Likely but unconfirmed legacy path:** “The application already had Mocha tests in [actual area], while Jest was used for [actual area]. We standardized expectations and reporting across both instead of performing a risky migration solely to reduce the number of runners.”

**Other valid path:** Different packages may have had different test requirements or existing infrastructure. Explain the real boundary; do not automatically assign Mocha to backend and Jest to frontend unless that was true.

Jest includes assertions, mocks, coverage integration, and a runner; Mocha is a runner commonly combined with other assertion/mocking/coverage tools. A gradual migration can target actively changed modules. Preserve valuable behavior coverage, and avoid counting duplicate tests across both runners as increased assurance.

### 4.2 React Testing Library or Enzyme? React 18 support?

**RTL path:** “We tested through user-observable behavior: accessible queries, input interactions, loading states, errors, and resulting content. That made the tests less coupled to internal component structure.” This follows the library’s testing philosophy. [Testing Library guiding principles](https://testing-library.com/docs/guiding-principles/).

**Enzyme legacy path:** “Existing tests inspected component internals or used shallow rendering. We prioritized migration of frequently changed and critical workflows to behavior-focused tests.” Identify the actual React/adapter versions; do not casually claim an unsupported combination had official support merely because a community adapter existed.

**Follow-up:** Avoid a wholesale mechanical rewrite that preserves brittle assertions. Migrate test intent: what should the user be able to do, what should appear, and what must be prevented? Neither library replaces real-browser coverage for layout, browser APIs, or critical end-to-end integration.

### 4.3 MSW or Jest mocks for API behavior?

**MSW path:** “Network-level handlers let the component and real HTTP client run together while controlling responses. We could exercise serialization, loading transitions, retries, and error mapping with less coupling to the HTTP library’s internals.” Match the project’s MSW version when discussing handler APIs.

**Direct mocks path:** “For a small unit test, mocking the service boundary was faster and more focused. Separate integration tests checked the real adapter.” A mocked Axios function will not automatically validate interceptors, request configuration, or wire-level behavior.

**Cases worth testing:** Slow response, abort, malformed payload, 401, 403, 429 with retry instructions, temporary 503, and a success after failure. Reset handlers between tests and fail on unexpected requests. Do not let unit tests accidentally call production services.

### 4.4 Coverage tool? Lines or branches?

**Sample:** “Jest generated coverage for its test scope, and the Mocha suite used [actual instrumentation tool, often nyc/Istanbul]. We measured [lines/statements/functions/branches] and published the report in CI.”

Line coverage means executable lines ran; branch coverage asks whether alternatives such as success/error paths were exercised. A line can be covered while an important false branch is never tested. Coverage also says nothing by itself about assertion quality.

**Follow-up:** Approximately 95% must refer to a named denominator and metric. Explain instrumentation exclusions, such as generated code, and make sure untested source files were included. If Jest and Mocha cover overlapping files, merge compatible reports correctly; averaging their percentages is not a valid repository-wide coverage calculation.

### 4.5 Which CI system, and how was the gate configured?

**Answer:** State Jenkins, GitHub Actions, GitLab CI, or the actual system. “The pipeline installed from the lockfile, ran tests with coverage, published artifacts, and failed when the relevant threshold was missed. That check was required for merging.” Your résumé establishes collaboration with DevOps, not the provider for this employer.

**Jest example for explanation only:** A configuration can set `coverageThreshold.global` values independently for `branches`, `functions`, `lines`, and `statements`. A value of 95 for all four is stricter than claiming approximately 95% line coverage. `collectCoverageFrom` controls which source files enter the report. [Jest configuration reference](https://jestjs.io/docs/configuration#coveragethreshold-object).

**Follow-up:** A coverage command that prints a red warning but exits successfully is not an enforced gate. Likewise, a failed job that can be ignored under the merge policy is not equivalent to a required check.

### 4.6 How did you keep PHI out of fixtures?

**Sample:** “We used synthetic data created for testing, including realistic formats and edge cases without copying production patients, claims, or screenshots.”

Synthetic data should include long names, unusual characters, missing values, dates at boundary conditions, and permission combinations. Do not export real records and assume replacing the name makes them anonymous: identifiers and contextual fields can remain.

**Follow-up:** Review snapshots, recorded HTTP fixtures, browser videos, screenshots, and error artifacts as well as JSON files. Secrets/PII scanners can help but cannot prove absence of PHI. Test-data generation and review ownership should be explicit. Any exceptional use of real or formally de-identified data requires the organization’s approved process, not an engineer’s improvised masking script.

### 4.7 How were CI secrets handled?

**Sample:** “Credentials came from the approved CI secret store or workload identity, with least privilege and environment separation. They were not committed or printed.”

Prefer short-lived credentials where the platform supports them. Separate build/test capabilities from deployment permissions; an ordinary unit test should not need production database access. Restrict which branches and jobs can access sensitive environments.

**Follow-up:** Masked log output is not a guarantee against exfiltration by untrusted code. Fork PRs and dependency installation scripts require careful trust boundaries. Rotate credentials after suspected exposure and check artifacts, cache entries, and debug output. A frontend build variable is public once embedded in browser JavaScript, regardless of whether CI originally stored it as a secret.

### 4.8 Did CI include dependency scanning or static analysis?

**If yes:** “We used [actual tool] for [dependency vulnerabilities/static code analysis/quality checks], with severity and exception handling defined by the team.” Distinguish SAST from software composition analysis; SonarQube, Snyk, and npm audit are not identical checks.

**If outside your ownership:** “DevOps/security owned the scanning configuration. I addressed findings in our code and dependencies, but I would verify the exact gate policy.”

Useful process details include scanning the lockfile actually built, assigning an owner to findings, documenting time-bounded exceptions, and verifying remediation. A clean scanner report is not proof of security. Do not mix coverage percentage and vulnerability counts into one generalized claim of application quality.

### 4.9 Did you test unauthorized access and token expiry?

**Sample:** “We tested missing credentials, expired credentials, denied permissions, session expiry during an action, and refresh failure. The UI had to clear protected state or show the correct recovery path without looping.”

**Backend/integration boundary:** A test hiding a button does not demonstrate that the API rejects unauthorized requests. Test direct cross-tenant IDs, access after revocation, and protected subscriptions at the enforcing service. State whether you wrote those tests or coordinated with the owning team.

**High-value race:** Several requests fail with 401 simultaneously. Verify one renewal, bounded replay, and consistent logout if renewal fails. Also test a late successful response arriving after logout so it cannot repopulate a cleared cache.

### 4.10 Who could change CI? Could a PR disable the coverage gate?

**Sample:** “Pipeline files and shared CI templates had designated reviewers, and merge policy required named checks. Changes to thresholds or exclusions needed review.” Describe actual repository permissions rather than assuming all CI providers enforce them automatically.

**Important weakness:** If a PR can redefine the supposedly required job to always succeed, the job name alone does not protect the standard. Protect trusted workflow definitions or organizational policy separately where supported. Review coverage configuration changes as carefully as source changes.

Admins may still have bypass powers. A credible answer acknowledges those controls and auditability rather than claiming the gate was technically impossible to bypass. Urgent exceptions should be explicit, owned, and followed by corrective work.

### 4.11 How long did the suite take? How did you speed it up?

**Historical answer:** Supply measured p50/p95 or representative timings if available. Otherwise say: “I do not recall the exact runtime, but we optimized the slowest suites using timing reports.”

**Approaches:** Run independent files in parallel, shard large suites, avoid duplicate setup, cache dependencies and transforms, and separate quick PR checks from slower browser suites. Shards should be balanced by observed duration rather than file count alone.

**Tradeoff:** Too many workers can increase memory pressure and make CI slower or flaky. Cache keys should include relevant lockfiles/tool versions. Do not cache a successful test result without a sound dependency graph that accounts for configuration and shared code changes.

### 4.12 Did jsdom become a bottleneck?

**Sample:** “We used a browser-like environment only where DOM behavior was required. Pure transformation, validation, and service-policy tests ran in a Node environment.”

Avoid loading the complete application provider tree for every tiny test. Use focused setup helpers, clean mounted components, and remove unnecessary global initializations. Time-consuming work may come from expensive imports or broad fixtures rather than jsdom itself, so profile before blaming the environment.

**Limit:** jsdom is not a real layout/rendering engine. It cannot establish D3 visual correctness, actual browser timing, focus behavior in every case, or performance on constrained hardware. Keep real-browser tests for those concerns instead of constructing increasingly elaborate DOM mocks.

### 4.13 How did you handle flaky tests?

**Sample:** “We tracked flakes as defects. The owner investigated race conditions, shared state, unstable clocks, and external dependencies. Retries helped identify or temporarily tolerate a known flake; they were not the permanent fix.”

Prefer waiting for an observable condition over fixed sleeps. Reset mocks and state, seed intentional randomness, isolate test data, and control clocks where appropriate. WebSocket tests should use deterministic event sequences rather than hoping a message arrives within an arbitrary delay.

**Quarantine policy:** A quarantined test needs an owner, issue, expiry, and visible reporting. Removing a critical check from the merge path without replacement creates a real coverage gap. Track first-attempt failure rates so retries do not make an unreliable suite appear healthy.

### 4.14 Performance regression tests: Lighthouse or bundle budgets?

**If implemented:** “We used [actual checks] to detect bundle growth or major page-performance regressions, with consistent build mode, route, device, and network settings.”

**If not:** “We performed performance checks during optimization, but they were not a permanent CI gate. Adding route-level byte budgets and representative browser scenarios would be the next improvement.” A performance project does not prove Lighthouse CI was installed.

Bundle size checks are relatively deterministic; browser timing is noisier. Use repeated runs and appropriate tolerances rather than failing on a tiny single-run timing change. For your dashboard, sustained update responsiveness and memory stability may be more relevant than a generic landing-page Lighthouse score.

### 4.15 How did CI remain manageable as the codebase grew?

**Sample:** “We separated fast feedback from broad confidence: affected unit/integration tests during development, required critical checks on PRs, and broader suites at an appropriate merge or scheduled stage.”

Affected-test selection is only as reliable as its dependency graph. Shared utilities, build config, test setup, schema changes, and dependency upgrades may require a wider run. Periodic full suites detect omissions in selection logic.

Track queue time as well as execution time. Adding workers does not help if all jobs wait for scarce runners or a shared test environment. Maintain deterministic fixtures, reduce redundant end-to-end cases, and test each behavior at the lowest layer that can meaningfully validate it.

### 4.16 Was 95% global or per file? What about legacy code?

**Global path:** A repository-wide threshold is easy to report but can hide an untested high-risk module behind well-covered utilities. **Per-file/path path:** Critical adapters or authorization logic can have specific requirements, while less critical areas have different expectations.

**Legacy strategy:** Baseline existing coverage, prevent regression, and require stronger coverage on changed code where tooling supports it. Combine that with targeted work on critical gaps. Do not erase legacy files from coverage solely to make a dashboard show 95%.

**Your answer:** Identify the actual scope and dimension. If you remember only “approximately 95% coverage,” say so and verify the CI configuration rather than expanding it into “95% of every file and every branch.”

### 4.17 How did standards work across teams?

**Sample:** “We provided shared test setup, examples, review expectations, and CI templates so teams could follow the same practices without copying fragile configuration.”

Standards should explain what to test: observable behavior, meaningful edge cases, async cleanup, synthetic data, and deterministic failures. Require consistency in outcomes while allowing different runners when there is a real technical reason.

**Adoption:** Pair on the first representative tests, document common patterns, and use code review to reinforce them. A written standard without maintained examples or required checks will drift. Do not claim organization-wide authority if your actual scope was one team and a few collaborating consumers.

### 4.18 Who owned broken tests in shared code?

**Sample:** “The shared-module maintainers owned the contract and common regression tests. A consuming team owned incorrect assumptions or misuse in its feature. The team introducing a breaking change coordinated the fix rather than leaving every consumer to diagnose it independently.”

Use ownership metadata and clear escalation paths. When the cause is uncertain, an explicit temporary incident owner prevents everyone from assuming another team will handle it.

**Release behavior:** Block the affected release, revert a harmful change, or apply a verified fix according to impact. Avoid deleting failing tests to unblock delivery without understanding whether they exposed a real regression. Shared code needs representative consumer integration tests because its local tests may miss supported usage patterns.

### 4.19 How did you prevent low-value tests from accumulating?

**Sample:** “We reviewed whether a test would fail for a meaningful user-visible defect. We removed redundant assertions, avoided oversized snapshots, and favored boundary cases tied to real risks.”

Examples of low value include asserting a mocked function returns the value you just configured, snapshotting thousands of irrelevant DOM lines, or testing private state names instead of behavior. Useful tests exercise transformations, contracts, error paths, authorization boundaries, and regressions that previously escaped.

Use incident review to improve missing scenarios. Selective mutation testing can reveal assertions that fail to catch changed behavior, but it adds cost and need not run everywhere. Coverage is a gap-finding signal; it should not incentivize executing lines without checking results.

### 4.20 How would this change for a 100-engineer organization?

**Proposed answer:** “I would treat test infrastructure as a maintained internal product: supported templates, reliable runners, clear ownership, test-impact analysis, and visible reliability metrics.”

Establish common contract-testing practices, controlled test environments, security checks, and a small set of critical end-to-end journeys. Give teams autonomy over local tests while enforcing release requirements appropriate to service risk.

Measure feedback time, flake rate, escaped defects, and recovery time rather than celebrating a single coverage number. Budget engineering time for infrastructure and test maintenance. A 100-engineer organization cannot depend on one person knowing how to repair every shared CI failure.

**Defending the 20%:** Explain what counted as a regression, the before/after periods, and exposure such as releases or active users. An illustrative change from 25 to 20 incidents is a 20% decrease. If deployment volume changed, compare a suitable rate as well as raw counts. Testing improvements may have contributed alongside other changes; observational incident data alone does not isolate causation.

## 5. Bundle optimization — 35% smaller initial bundle with Webpack 5

**Opening answer template:** “I analyzed the JavaScript required for the initial route and moved noncritical functionality behind dynamic imports. Webpack 5 created route or feature chunks, allowing the first view to load less code. The measured initial bundle decreased 35% on a consistent [raw/gzip/Brotli] basis. I also checked [actual loading and CPU measurements] on constrained hardware, because fewer downloaded bytes do not automatically mean a proportional improvement in user experience.”

### 5.1 Which bundle-analysis tool?

**webpack-bundle-analyzer path:** “I inspected the production stats to find large modules, duplicated dependencies, and code pulled into the entry route unexpectedly.” **source-map-explorer path:** “I used source maps to attribute generated bytes to source modules.” Explain which build and byte representation you examined.

The browser network waterfall answers a different question: which chunks actually load for a route, in what order, and with what transfer size. A treemap can show a large lazy chunk that never affects initial navigation.

**Follow-up:** Save before/after build reports and compare the same route and production configuration. Do not claim the npm package’s unpacked size was the amount downloaded by the browser. If the exact analyzer is forgotten, explain the analysis method without guessing the tool name.

### 5.2 What were the largest offenders? Moment or lodash?

**Your confirmed stack:** D3 is a candidate to inspect, but it is not established as the largest offender. Heavy charts, editors, export tools, duplicated versions, locale data, and route modules are common investigation targets, not facts about your build.

**If Moment was replaced:** Explain whether `Intl`, date-fns, Day.js, or another tool covered the actual requirements. Test time zones, daylight-saving boundaries, parsing, locale formatting, and mutable versus immutable behavior. Healthcare date-only values must not accidentally shift a day through a time-zone conversion.

**If lodash changed:** ESM-compatible `lodash-es` or supported per-method imports can reduce included code depending on the build. Verify output rather than assuming any import spelling guarantees tree shaking. Avoid replacing well-tested functionality with a subtly incorrect homemade utility solely for a small byte saving.

### 5.3 React.lazy or loadable-components? SSR needs?

**React.lazy path:** “The client-rendered application used dynamic imports with `React.lazy` and appropriate Suspense boundaries. We kept important navigation and the basic shell available while a deferred feature loaded.” An error boundary or equivalent recovery path handles failed chunk loads; Suspense alone does not solve every error.

**Loadable path:** “We needed the project’s supported server-rendering/chunk-extraction workflow, or it was already the established integration.” Verify library and React versions before making SSR capability claims.

**Nuance:** Do not say React.lazy can never work with server rendering; capabilities depend on the React and framework setup. For your project, explain whether SSR was present at all. A simple client-rendered internal dashboard often does not need an additional SSR-oriented loading library.

### 5.4 How did you configure splitChunks and vendor boundaries?

**Sample:** “We started from sensible Webpack defaults and adjusted boundaries after observing duplication and route usage. Dynamic imports defined feature boundaries; `splitChunks` extracted genuinely shared dependencies where beneficial.”

Using `chunks: 'all'` can allow shared extraction across initial and asynchronous chunks, but it does not mean every extracted module must load on the first route. Conversely, eagerly importing a heavy module from the entry graph still makes it an initial dependency. [Webpack code splitting](https://webpack.js.org/guides/code-splitting/).

**Tradeoff:** One giant vendor chunk can force users to download dependencies for unrelated routes. Too many tiny chunks increase request and coordination overhead. Group by meaningful reuse and change frequency, then validate actual request waterfalls, cache behavior, and total initial-route bytes. Avoid presenting an arbitrary cache-group config as universally optimal.

### 5.5 Did Babel targets or polyfills change?

**If yes:** “We aligned browser targets with the approved support matrix and audited transformations and polyfills against actual requirements. We removed unnecessary compatibility code only after verifying supported environments.”

Syntax transforms and runtime polyfills are different: transforming optional chaining does not provide a missing runtime API. Usage-based polyfills, explicit polyfill entry points, and modern/legacy outputs have different operational tradeoffs.

**If not:** “The 35% reduction came from code loading boundaries; browser targets remained governed by the existing support policy.” This is a complete answer. Do not claim dropping older browsers if hospital or enterprise-managed devices still required them. Check embedded webviews and managed browser versions before recommending an aggressive target.

### 5.6 Were production source maps public?

**Private-monitoring path:** “Production source maps were uploaded to the approved error-monitoring system with controlled access and excluded from publicly served artifacts.”

**Important distinction:** A hidden source-map setting can omit the reference comment while still generating a map file. If that file is deployed to a public bucket/CDN, someone who knows its URL may retrieve it. Build configuration and deployment rules both matter.

**If maps were public:** Acknowledge that choice and its source-disclosure implications without claiming maps are credentials. Secrets must never be embedded in frontend bundles with or without maps. Private maps improve debugging but should still be reviewed for sensitive source content, access controls, and retention.

### 5.7 How did splitting interact with CSP? Nonces and publicPath?

**Sample:** “Dynamic chunks had to load from origins permitted by our Content Security Policy. We tested production chunk loading under the actual policy, rather than weakening the policy when a deferred route failed.”

For nonce-based policies, the generated script elements need the required nonce through the supported runtime integration. Webpack documents its nonce mechanism. The nonce must be unpredictable and generated per response; a fixed build-time string is not a secure nonce. [Webpack CSP guidance](https://webpack.js.org/guides/csp/).

`publicPath` determines where chunks are requested; it does not grant CSP permission. A wrong path causes failed chunk fetches even if the CSP is correct. Avoid production configurations relying on `eval` when the policy forbids it. Also test styles, workers, fonts, and connections under their appropriate directives.

### 5.8 Did you use Subresource Integrity?

**If yes:** “We generated integrity metadata for the relevant assets and verified the loading integration applied it, including runtime-loaded chunks where supported.” Cross-origin resources must meet the relevant CORS requirements for integrity checks. [MDN Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Subresource_Integrity).

**If no:** “We served versioned assets from our controlled origin/CDN and did not implement SRI for every chunk.” That is more credible than claiming a content-hashed filename automatically provides SRI.

**Distinction:** A hash in a filename supports versioning and caching. SRI has the browser verify resource bytes against supplied integrity metadata. It does not protect a user if an attacker can modify both the HTML and the trusted integrity value. Explain the threat it addresses rather than calling it complete supply-chain protection.

### 5.9 How did you vet replacement libraries?

**Sample:** “We compared functional compatibility, maintenance, security history, license terms, runtime support, and total bundle impact, including transitive dependencies.”

Create representative cases for the behavior being replaced: locale/date boundaries, deep object operations, accessibility behavior, or export format compatibility. A smaller library that changes important semantics can cause more harm than the original byte cost.

**Rollout:** Replace one bounded use case, measure the resulting build, and verify critical consumers before broad removal. Ensure the old library actually disappears from the production dependency graph; one remaining import can erase much of the expected saving. Replacements also need an owner and an update policy.

### 5.10 Did dependency changes reduce vulnerability exposure?

**Sample:** “Removing unused dependencies reduced shipped code and maintenance obligations. Where scanner findings disappeared, we compared the same scan basis before and after.”

Separate production runtime dependencies from build-only tools and transitive packages. Removing a browser bundle reference does not necessarily remove a vulnerable package from the build environment; conversely, a build-time vulnerability may not be exploitable in the deployed client.

**Honest limit:** Smaller bytes do not map to a calculable percentage reduction in security risk. If you did not track vulnerabilities, say the measured result was bundle reduction and any security benefit was not quantified. Avoid inventing a CVE count or claiming that every removed package was dangerous.

### 5.11 Gzip or Brotli? What were before/after sizes?

**Answer format:** “Initial-route JavaScript decreased from [baseline] to [after] using [compression and level], measured from [build report/network transfer].” Include all scripts required for that route, not only a conveniently named `main.js` file.

**Illustrative arithmetic:** 1,000 KB to 650 KB on the same measurement basis is a 35% reduction. It is invalid to compare a raw baseline with a Brotli-compressed result. Compression settings and cache state should be consistent.

**Follow-up:** Report raw size separately when discussing parsing, because the browser decompresses transferred JavaScript before executing it. The sum of all deployment chunks may stay similar even though initial download decreases substantially. That is expected when code is deferred rather than removed.

### 5.12 Which load metric improved: TTI, LCP, or FCP?

**Sample:** “The primary bundle claim was a byte reduction. The user-experience result was measured with [actual metric], under [conditions]. I would not automatically equate 35% fewer bytes with 35% faster loading.”

FCP concerns first content; LCP concerns the largest contentful element; current Core Web Vitals also include INP for interaction responsiveness and CLS for visual stability. A dashboard may need an additional application-specific ‘usable data visible’ measure. [Web Vitals definitions](https://web.dev/articles/vitals).

**If TTI was used historically:** Name it as the historical lab metric and describe the tool/version. Do not call it a current Core Web Vital. LCP can remain constrained by a slow API or image even after substantial JavaScript reduction. Report both lab conditions and available field evidence.

### 5.13 Did you measure parse/execution on low-end devices?

**If yes:** “We compared production builds on [actual devices or documented throttling], looking at script evaluation, long tasks, time to meaningful content, and responsiveness.”

CPU throttling is a useful repeatable approximation, not a full substitute for real hardware with different memory, browser, and thermal behavior. Record whether the cache was cold or warm; code caching can materially change repeated loads.

**Follow-up:** Compression reduces transfer bytes but does not shrink the JavaScript that must be parsed after decompression. Deferring chart or export code can reduce initial main-thread work; it may introduce a cost at first use. Measure that later interaction too, especially if the deferred feature is commonly used immediately after login.

### 5.14 How did you prevent chunk waterfalls? Prefetch or preload?

**Sample:** “We avoided a dependency sequence where the route first loaded, then discovered a widget, which then discovered another heavy module. We grouped tightly related code or initiated predictable dependencies early.”

**Prefetch:** Useful for a likely future navigation when spare resources exist. **Preload:** Appropriate for a resource needed by the current navigation; misuse can compete with critical work. Webpack supports import hints, but their actual browser scheduling and route effects must be checked. [Webpack prefetch/preload guidance](https://webpack.js.org/guides/code-splitting/#prefetchingpreloading-modules).

An intent signal such as link hover/focus can be useful, provided it does not trigger sensitive data requests unnecessarily. Prefetching every route can erase bandwidth benefits on constrained networks. Inspect real waterfalls and compare both first navigation and repeat navigation.

### 5.15 How did long-term caching work?

**Sample:** “Static assets used content-based filenames, and unchanged files could remain cached across deployments. We kept the runtime/manifest handling stable enough that unrelated code changes did not invalidate every large dependency chunk.” Webpack’s caching guide discusses content hashes and runtime extraction. [Webpack caching](https://webpack.js.org/guides/caching/).

For fingerprinted immutable assets, long cache lifetimes are appropriate. HTML and manifests need a policy that allows clients to discover new versions. Validate deployment order so HTML never points to files that are not yet available.

**Important boundary:** These are public static-code caching practices, not permission to publicly cache authenticated healthcare responses. API cache controls, CDN keys, and browser storage policy need separate treatment. Measure repeat-visit savings rather than assuming content hashes guarantee ideal caching.

### 5.16 How did you prevent the bundle from growing back?

**Sample:** “We made route-level initial JavaScript size visible in PRs and defined budgets for important entry points. Large dependency additions required a reason and an analysis of which users would download them.”

Tools such as size-limit, bundlesize, or Webpack performance settings are options; identify the actual implementation if one existed. A per-file maximum alone is easy to satisfy by splitting one large download into many smaller files, so include total initial-route bytes and, where practical, parse/interaction measures.

**Process:** Establish a baseline, handle intentional increases explicitly, and reassess budgets when requirements change. Do not silently raise thresholds on every failure. Watch for new imports from shared modules that accidentally pull deferred functionality back into the initial graph.

### 5.17 Old tab after deployment: ChunkLoadError?

**Primary prevention:** “We retained old fingerprinted assets for a deployment overlap window so an already-open tab could still load the chunks named by its version.” Atomic deployment and appropriate HTML caching reduce mixed-version states.

**Recovery:** A chunk error can result from offline conditions, transient CDN failures, or removed old assets. Distinguish these where possible. Offer a bounded retry or a clearly explained refresh path, preserving unsaved work according to the application’s data policy.

**Follow-up:** Avoid automatic infinite reload loops. A version-aware one-time recovery guard can help, but a full refresh is disruptive and may not solve a continuing outage. A service worker adds another version/cache lifecycle to manage; do not claim one was present unless it was.

### 5.18 How did splitting evolve as routes grew?

**Sample:** “Routes provided a natural first boundary. Particularly heavy optional functionality inside a route became a second boundary. Shared code was extracted according to real reuse.”

Keep critical shell and authentication UX small. Review shared barrel imports and root providers, because they can accidentally create eager dependencies across all routes. Track both frequently visited routes and expensive rarely used workflows.

**Tradeoff:** Over-splitting can create many requests and loading placeholders. Under-splitting makes users pay for irrelevant features. As the application grows, use route usage, network conditions, and interaction traces to adjust boundaries rather than creating one chunk per component by rule.

### 5.19 Would micro-frontends or Module Federation have helped?

**Sample:** “The problem described here was excessive initial JavaScript, which code splitting addressed within the existing application. I would consider micro-frontends if independent team ownership and deployment justified the extra runtime and integration complexity.”

Module Federation can support sharing/loading independently built modules, but it can also introduce duplicate dependencies, version negotiation problems, inconsistent design, and failure modes when remotes are unavailable. It does not inherently reduce bundle size.

**Healthcare-specific engineering concern:** Authentication boundaries, auditability, CSP, and consistent authorization behavior become harder to coordinate across independently released surfaces. A proposal should show ownership and release benefits large enough to justify these costs; it should not be presented as an automatic upgrade from a modular React application.

### 5.20 Webpack or Vite today?

**Answer for this project:** “Webpack 5 was the existing build system, and we achieved the optimization through targeted changes. Replacing the build tool was not necessary to obtain that result.”

**For a new project today:** Evaluate Vite for the development experience and supported framework ecosystem, while checking the current release’s production build behavior, plugins, browser targets, and organizational requirements. Use current documentation rather than an old blanket description of its internals. [Vite getting started](https://vite.dev/guide/).

**For migration:** Compare build times, local startup, HMR, asset behavior, worker support, environment variables, tests, source maps, and actual production output. Keep Webpack when custom loaders/plugins or migration risk make it the better fit. Developer build speed and end-user runtime performance are separate measurements.

**Defending the 35%:** Use `(before initial bytes − after initial bytes) / before initial bytes × 100`. Identify route, compression, browser/cache conditions, and build configuration. Explain which bytes were eliminated and which were deferred. The strongest evidence combines bundle reports, route waterfalls, and a measured improvement relevant to constrained hardware.

## 6. API integration — retries, error handling, OAuth, and protected data

**Opening answer template:** “I built a shared API integration layer so features handled credentials, transient failures, and user-facing errors consistently. OAuth-based access was part of the application’s security design. The layer applied bounded retries to eligible requests, exposed understandable recovery states, and coordinated authentication failures. Backend services remained responsible for validating access and enforcing resource permissions.”

**Terminology:** OAuth 2.0 is an authorization framework. OpenID Connect adds a standardized identity layer for authentication. Your confirmation establishes OAuth usage, but does not establish that the system used OIDC, a particular grant, or a particular identity provider. Explain the actual login/session architecture rather than assuming OAuth alone proves identity. OAuth also does not make an application HIPAA compliant by itself; organizational, infrastructure, and data-handling controls remain relevant. [HHS Security Rule overview](https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html).

### 6.1 Axios or fetch? Interceptors and timeouts?

**Axios path:** “A configured client applied the base URL and safe headers. Request interceptors attached current credentials only to approved API origins; response handling normalized errors and coordinated authentication recovery.” Avoid installing an interceptor during every render; duplicated interceptors can cause repeated refreshes and memory leaks.

**Fetch path:** “A wrapper checked `response.ok`, parsed the expected response type, normalized failures, and supported cancellation.” Fetch does not reject merely because the HTTP response is 404 or 500. Handle 204/empty responses without blindly parsing JSON.

For timeouts, use `AbortController` with a cleared timer, or `AbortSignal.timeout(...)` where browser support permits. The latter supplies a timeout signal; it is not a universal deadline magically built into every fetch call. [MDN timeout signal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static).

### 6.2 React Query, SWR, or custom hooks?

**Query-library path:** “We used [actual library] for server-state caching, request status, deduplication, and invalidation. The HTTP adapter handled transport and authentication, while the query layer handled resource freshness.”

**Custom-hook path:** “The application used focused hooks over a shared client. We implemented the needed loading, cancellation, stale-response protection, and error behavior ourselves.” Explain the maintenance tradeoff honestly; a custom hook that calls fetch does not automatically have a correct caching system.

**Important separation:** Local UI state, authenticated session state, and server-resource state have different lifecycles. Avoid independently caching the same record in multiple stores without a clear owner. Shared query keys should include tenant and relevant parameters so separate contexts cannot collide.

### 6.3 Retry library or custom logic?

**Library path:** “We configured [actual library] with a narrow retry predicate, maximum attempts, delay policy, and cancellation behavior.” Defaults may not match healthcare workflow semantics, especially for writes.

**Custom path:** “We needed endpoint-specific policy, so retry decisions were centralized in a small adapter rather than repeated in components.” Keep the policy testable: distinguish retryable transport failures from permanent validation, authorization, and application errors.

**Follow-up:** Only one layer should own a given retry budget. If the HTTP adapter retries three times and the query library repeats the whole operation three times, attempts multiply. Count the original attempt consistently, apply an overall deadline, and report the final useful error rather than a chain of duplicate notifications.

### 6.4 Which OAuth library? Why not custom auth?

**Answer:** Name oidc-client-ts, MSAL, Okta/Auth0 SDK, or the actual maintained client if remembered. Explain what it owned: redirect initiation, callback handling, state/nonce validation where applicable, token lifecycle, and session integration.

**Custom wrapper is not necessarily a custom protocol:** “We wrapped the organization’s supported identity client with application-specific session and error handling.” That is different from hand-writing token validation or inventing OAuth flows.

**If protocol handling was custom:** Explain the historical constraint and review process, then acknowledge maintenance and security costs. Browser OAuth clients are public clients: an embedded client secret cannot be kept confidential. A BFF may move the OAuth client responsibilities to a server instead, leaving a session cookie in the browser.

### 6.5 Which identity provider?

**Historical answer:** “[Actual provider] issued credentials, and our APIs validated them according to the agreed issuer, audience, lifetime, and permissions.” Okta, Azure AD/Microsoft Entra ID, Auth0, and an internal identity system are alternatives, not details to infer from the use of OAuth.

If forgotten: “I integrated the organization’s OAuth-based authentication, but I would need to verify the identity provider name.” You can still explain the redirect, callback, session lifecycle, and API validation responsibilities you implemented.

**Follow-up:** A JWT is a token format, not an identity provider or OAuth flow. Decoding a JWT in the browser does not validate its signature or authorize an operation. Opaque access tokens may instead require server-side introspection; not every OAuth system uses JWT access tokens.

### 6.6 Which OAuth flow? What attack does PKCE prevent?

**Authorization Code with PKCE path:** “The client generated a random verifier and sent its S256 challenge in the authorization request. The callback returned a short-lived code. Redeeming that code required the original verifier, so an attacker who intercepted only the code could not exchange it successfully.” PKCE binds the authorization request to code redemption. [RFC 7636](https://www.rfc-editor.org/info/rfc7636/).

Use the approved SDK for transaction binding and redirect validation. OIDC nonce validation, when applicable, addresses a related but distinct identity-response concern. PKCE does not stop malicious JavaScript already executing inside the legitimate application from abusing that application’s access.

**Legacy implicit path:** Explain it as a historical constraint if true, and describe a migration toward Authorization Code with PKCE. Current OAuth security guidance discourages response types that return access tokens through the authorization response. Do not pretend an old deployment already followed a standard published later. [OAuth Security BCP, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html).

### 6.7 Where were tokens stored? localStorage, cookies, or memory?

**Memory:** Limits persistence, but active XSS can still act within the application. A page refresh requires session restoration through the identity system or a server session; the original memory token does not survive. Third-party-cookie restrictions can affect iframe-based silent renewal.

**HttpOnly session cookie/BFF:** Keeps the server-held OAuth tokens out of JavaScript. Cookies sent automatically need CSRF defenses for state-changing operations: appropriate SameSite settings, anti-CSRF tokens or equivalent controls, and server-side origin validation where applicable. HttpOnly does not prevent XSS from issuing authenticated requests. [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

**localStorage:** JavaScript-readable and persistent across reloads, so token theft via XSS is a central risk. If historically used, say so and describe the actual mitigations and migration direction. Do not claim encoding or encrypting with a key available to the same JavaScript makes it safe from that JavaScript.

### 6.8 Refresh-token rotation or a backend-for-frontend?

**Rotation path:** “Each refresh returned a replacement refresh token; reuse detection and token-family handling were enforced by the authorization server.” The frontend should coordinate refreshes to avoid accidental concurrent reuse. Current OAuth guidance requires public-client refresh tokens to use rotation or sender constraint; actual historical implementation must still be verified. [RFC 9700 refresh-token protections](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14).

**BFF path:** “The browser held an HttpOnly session cookie. The BFF stored tokens, renewed them, and called the downstream APIs.” This reduces browser token exposure but adds server ownership, CSRF requirements, proxy capacity, and session lifecycle work.

**No refresh-token path:** A short-lived access token with reauthentication/session renewal can be a deliberate design. Do not claim rotation simply because users stayed signed in; a long browser session does not reveal how credentials were renewed.

### 6.9 How did you keep PHI out of logs, Sentry, and errors?

**Sample:** “We logged controlled error codes, route templates, timing, and correlation IDs instead of request bodies, sensitive query strings, authorization headers, or patient data. User-facing messages described the action the user could take without echoing backend payloads.” Sensitive data and access tokens should be excluded or appropriately treated in logs. [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

**If Sentry was used:** `beforeSend` can filter applicable error events, but separate review is needed for breadcrumbs, transactions, attachments, replay, and SDK integrations. Scrubbing one event hook is not proof that every telemetry channel is covered. Prefer preventing collection over relying entirely on downstream removal.

**Follow-up:** Redact at each relevant layer, including proxies and server logs. Correlation IDs let support locate an incident without showing users a stack trace. Avoid putting sensitive values into the logging message while trying to report that a sensitive field was rejected.

### 6.10 What happened on logout or inactivity timeout?

**Sample:** “We invalidated the application session, stopped new authenticated work, canceled requests where possible, closed protected subscriptions, and cleared user-scoped caches and state. The server enforced expiry independently.”

If refresh-token revocation or identity-provider logout was supported and appropriate, explain how it was used. Local logout and global identity-provider logout are different behaviors. Clearing browser state alone does not revoke every already-issued bearer token; server policy and token lifetime still matter.

**Race handling:** Increment a session generation or equivalent guard so responses started before logout cannot restore protected data afterward. Clear data across relevant tabs without broadcasting sensitive payloads. Inactivity policy should follow actual application requirements; do not invent a mandated universal HIPAA timeout value.

### 6.11 How were timeouts chosen? Different by endpoint?

**Sample:** “Timeouts reflected the endpoint’s expected latency and the user’s action. An interactive lookup had a tighter budget than a large export. We used observed latency percentiles and service expectations rather than one arbitrary value everywhere.”

Separate an attempt timeout from the total operation deadline, which includes retries and waits. A three-second attempt retried several times can keep the user waiting far longer than three seconds.

**Long-running operations:** Start an asynchronous job, return an identifier, and show progress/status instead of leaving a browser request open indefinitely. Canceling a client request does not prove the server stopped processing it. This distinction is particularly important for writes and exports with side effects.

### 6.12 Did you deduplicate identical in-flight requests?

**Sample:** “Concurrent reads of the same resource could share one in-flight promise or a query-library entry. The request key included the resource, normalized parameters, and relevant tenant/session scope.”

Do not deduplicate requests merely because they share a URL if headers, permissions, locale, or other inputs alter the result. Writes generally need business-specific handling; two similar submissions may represent separate intended actions.

**Cleanup and cancellation:** Remove an entry when it settles. If several components share a request, one consumer unmounting should not cancel it for everyone unless the library’s ownership policy allows that. After logout or tenant switch, old results must not be returned to a new session through an incorrectly shared key.

### 6.13 How were responses cached and invalidated? PHI in memory?

**Sample:** “We cached according to data sensitivity and freshness requirements. Keys included user/tenant scope, entries had bounded retention, and mutations invalidated or updated affected resources. Logout and context changes cleared protected caches.”

In-memory storage is still processing sensitive data; it is not automatically compliant or forbidden solely because it is memory. The approved application design determines what is necessary and acceptable. Persistent storage, service-worker caches, browser HTTP caches, and CDN caches require separate review.

**Invalidation examples:** Updating a record may affect its detail view, a filtered list, and aggregate counts. WebSocket messages can update a versioned cache entry or mark it stale. An arbitrary five-minute TTL does not ensure correctness if the workflow requires immediate visibility of a status change.

### 6.14 Did you cancel requests on unmount or route change?

**Sample:** “The request layer accepted an abort signal. Component or query lifecycle cleanup canceled work no longer needed, and an aborted request did not produce a misleading failure toast.”

Cancellation is especially useful for rapidly changing search queries. Also guard against stale responses: if request A completes after request B, its older result must not overwrite the current search state. Request IDs, query keys, or library lifecycle guarantees can solve this.

**Follow-up:** Abort is best effort from the browser’s perspective and does not roll back a server-side mutation. A user navigating away after submitting a write needs an eventual-status strategy, not an assumption that the write disappeared. Shared in-flight requests also need ownership-aware cancellation.

### 6.15 Many requests receive 401 simultaneously: one refresh or many?

**Sample:** “We used single-flight renewal. The first eligible 401 created a shared refresh promise. Other eligible requests waited for it. After success they retried once with the new credential; on failure they all entered the same signed-out state.”

**Details that matter:** Exclude the refresh request from the refresh interceptor. Mark replayed requests so a persistent 401 cannot loop. A 403 is not automatically solved by token refresh. If a late 401 belongs to an older token generation after renewal already succeeded, retry with the current credential rather than unnecessarily refreshing again.

**Multi-tab and writes:** A per-tab promise does not coordinate separate tabs. Use the supported SDK/session architecture for shared rotation. Replay writes only under a contract that makes them safe, especially if middleware behavior leaves ambiguity about whether the original operation ran. Cancel waiting work when logout occurs.

### 6.16 How did you prevent retry storms? Why jitter?

**Sample:** “Retries had exponential backoff, randomness, a maximum attempt count, and an overall deadline. We retried only eligible failures and stopped when the user canceled or the operation was no longer relevant.”

**Illustrative full-jitter formula:** `delay = random(0, min(cap, base × 2^attempt))`. Without jitter, many clients failing at the same instant can retry at the same later instants, creating recurring traffic spikes. Randomness spreads their attempts.

Also limit concurrent work, avoid redundant retry layers, and respect server overload signals. If the browser is offline, rapid retries are wasteful; wait for an appropriate recovery opportunity while preserving cancellation. Backoff improves load behavior but does not make unsafe write retries correct.

### 6.17 How did you handle 429 and Retry-After?

**Sample:** “We treated rate limiting separately from generic failure. When a valid `Retry-After` header was present, we waited at least the indicated delay if the operation’s overall deadline allowed it.”

The header can be a number of seconds or an HTTP date. Parse both and account for clock differences and invalid values. A valid delay can exceed the interactive budget; in that case stop automatic retries and explain when the user can try again instead of retrying earlier. [MDN Retry-After](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After).

**Follow-up:** Coordinate requests sharing a quota, and add jitter without violating the server’s minimum delay. For cross-origin browser requests, the server may need to expose the header through CORS for JavaScript to read it. Avoid a countdown promising success when only the earliest retry time is known.

### 6.18 Did you implement a client circuit breaker?

**If yes:** “After a defined pattern of eligible failures, the client temporarily stopped automatic calls to the affected dependency. After a cooldown, a limited probe checked recovery.” Explain closed, open, and half-open states and the actual scope.

**If no:** “We used bounded retries and appropriate UI recovery rather than a formal circuit breaker.” This is a valid answer; not every frontend needs one.

**Tradeoff:** Client state is local to a tab or device, so it cannot protect a service as effectively as coordinated server-side overload controls. Do not open a breaker because one user received a validation error or lacked permission. Scope it to the dependency and failure class, and provide a clear manual recovery path when appropriate.

### 6.19 Which requests were safe to retry? Idempotency for writes?

**Sample:** “We retried reads when failures were plausibly transient. For writes, we checked the endpoint’s semantics and idempotency contract instead of treating every timeout as proof that nothing happened.”

HTTP defines safe/idempotent methods, but application implementation still matters. PUT and DELETE are idempotent by intended effect; repeated responses need not be identical. POST is not automatically idempotent. A request can commit on the server and lose its response in transit. [HTTP semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-idempotent-methods).

**Idempotency-key design:** Generate one key for one logical operation and reuse it on retries. The server scopes the key to the authorized caller/operation, stores the request fingerprint and result atomically, handles concurrent duplicates, and rejects a mismatched payload. Do not generate a new key for each retry. An unknown outcome may require querying operation status rather than resubmitting blindly.

### 6.20 How would the layer evolve across many backend services?

**Proposed answer:** “I would retain a small shared transport/auth/error policy and keep typed domain clients separate. A single enormous client with service-specific conditionals would become hard to test and change.”

**API gateway:** Useful for routing and centralized cross-cutting controls, but business/resource authorization still belongs at an appropriate enforcing layer. **BFF:** Useful for UI-specific aggregation, token handling, and reducing browser orchestration. **GraphQL:** Useful for some data-composition needs, with costs around resolver authorization, query complexity, caching, and N+1 queries.

Choose based on observed pain: duplicated requests, excessive round trips, token exposure, contract drift, or independent service evolution. Add contract validation, versioning, correlation IDs, and dependency-specific observability. Keep PHI handling explicit across new intermediaries. None of these architectures removes the need for cancellation, safe retries, permission checks, and bounded caching.

## Practice aids: explain the mechanisms, not only tool names

### Touchstone experiment — 90-second structure

1. **Problem:** Name the actual workflow and observed user issue.
2. **Hypothesis:** Explain why the specific UI change should alter useful behavior.
3. **Implementation:** Touchstone supplied the experiment capability; explain the actual assignment-to-React integration and exposure logging.
4. **Evaluation:** Identify the assignment unit, metric/session definition, sample size, analysis method, and stopping rule.
5. **Result:** Average duration increased 30% relative to the stated baseline; explain uncertainty and any task-success evidence.
6. **Ownership:** Separate what you implemented from platform, product, analyst, and security responsibilities.

### D3 dashboard — a concrete design you can draw

This is a reference design, not a claim that every component existed in your project:

```text
Authorized REST snapshot + sequence cursor
                    |
                    v
            Normalized live state <--- validated WebSocket events
                    |                  (sequence/version checked)
             bounded batch updates
                    |
                    v
              React containers
                    |
                    v
        D3 scales/geometry + chosen renderer

Reconnect or sequence gap -> replay after cursor, or fetch fresh snapshot
Logout/permission change -> stop subscriptions and clear protected state
```

Be ready to explain initial snapshot races, stable entity IDs, background-tab behavior, and whether React or D3 owns each chart node.

### OAuth renewal — reference sequence

1. A request uses the current credential generation.
2. An eligible 401 triggers a check: has another request already renewed that generation?
3. If renewal is needed, create or join one refresh operation.
4. Renew successfully, then replay eligible requests once using the latest credential.
5. On renewal failure, invalidate the session and reject waiting requests consistently.
6. On logout or tenant change, prevent late responses from restoring the previous session’s data.

This is a design explanation, not a reason to implement custom OAuth protocol handling instead of a supported identity client.

### Metric evidence sheet

| Claim | Calculation / precise meaning | Evidence to bring |
|---|---|---|
| +30% session duration | `(treatment mean − control mean) / control mean` | Actual means, unit, population, dates, sample size, uncertainty, task-success context |
| −25% refresh latency | `(old latency − new latency) / old latency` | Same start/end definition, workload, statistic, and clock methodology |
| Reuse across workflows | Shared code serving genuinely distinct consumers | Two specific examples, API boundaries, consumer differences, ownership |
| ~95% coverage | Covered items / instrumented eligible items | Dimension, scope, exclusions, threshold, required CI result |
| −20% regressions | `(old count/rate − new count/rate) / old count/rate` | Incident definition, comparable periods, deployment volume, other contributing changes |
| −35% initial bundle | `(old initial bytes − new initial bytes) / old initial bytes` | Route, compression, build reports, network waterfall, device/loading evidence |
| Resilient secure API layer | Correct behavior under failure and denied access | Retry policy, auth flow, token lifecycle, permission enforcement, recovery tests |

### Details still worth recovering from your own work

- **Touchstone:** SDK/API integration, assignment location, randomization unit, analytics destination, analysis engine, exact UI experiment.
- **D3 dashboard:** SVG/Canvas approach, DOM ownership, socket client, live-state store, snapshot/replay protocol, actual refresh-latency baseline.
- **Shared React code:** Two concrete reusable components/hooks, consumer workflows, styling foundation, distribution mechanism.
- **Testing:** Jest/Mocha division, component-test library, CI provider, coverage dimensions, baseline regression period.
- **Webpack:** Analyzer, largest initial dependencies, route boundaries, raw/compressed before-and-after sizes, observed hardware effects.
- **OAuth/API:** Client/SDK, identity provider, grant, token storage, renewal strategy, retryable endpoints, actual server responsibilities.

When a detail is outside your ownership, a useful answer is: “I did not own that configuration, so I do not want to guess. My part was [specific responsibility]. The contract I depended on was [specific behavior], and I verified it through [actual evidence].” Follow with a proposed design only when the interviewer asks how you would build or improve it.
