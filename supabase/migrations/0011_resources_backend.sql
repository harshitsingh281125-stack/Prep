-- 0011_resources_backend.sql
-- Phase 4.5: widen the RAG corpus from 118 to 202 entries, adding 9 areas that
-- cover backend, DSA and distributed-systems interview prep.
--
-- WHY: `npm run probe:coverage` measured the corpus against every topic in the
-- user's real roadmaps and found 56 MISSING and 17 THIN out of 189. The corpus
-- was frontend-only; the roadmaps had moved on to DSA, databases, messaging,
-- auth, observability and system design.
--
-- THE THIN ONES WERE THE REASON THIS COULD NOT WAIT. A missing topic is labelled
-- UNVERIFIED and is honest. A topic with exactly one weak match above the floor
-- renders as a vetted link with a green VERIFIED chip on the wrong document:
--     Circuit Breaker Pattern      -> Martin Fowler: Micro Frontends   @ 0.622
--     Redis Data Structures        -> MDN: HTTP caching                @ 0.622
--     JWT Structure and Security   -> MDN: Cross-site request forgery  @ 0.625
-- That is the failure this phase exists to prevent, arriving quietly through
-- thin coverage rather than through hallucination.
--
-- Sources are weighted to primary and long-lived: RFCs, PostgreSQL, Kafka,
-- Redis, gRPC and GraphQL official docs, the Google SRE book, OpenTelemetry,
-- microservices.io, cp-algorithms, and Wikipedia for canonical CS concepts that
-- have no better stable home.
--
-- Same standard as every batch: **every URL fetched and confirmed 200 at the
-- exact path written here, no redirect.** This batch caught six problems — three
-- silent redirects (the AWS Builders' Library has moved to builder.aws.com,
-- kafka.apache.org/intro gained a trailing slash, MDN moved TLS under
-- /Security/Defenses/), one transient 503 that passed on retry, and two
-- Cloudflare learning-centre pages that 403 automated clients (real pages, but
-- unverifiable by the same standard as the rest, so Wikipedia and RFC 8446 are
-- used instead rather than weakening the rule).
--
-- After applying: npm run embed:corpus   then   npm run probe:retrieval

insert into public.resources (topic_area, kind, title, url, summary) values

-- =========================================================================
-- algorithms — DSA patterns and complexity
-- =========================================================================
('algorithms','deep','cp-algorithms: Binary search','https://cp-algorithms.com/num_methods/binary_search.html',
 'The binary search invariant and how to get the boundaries right, plus binary search on the answer for monotonic predicates. The template behind lower bound, upper bound and search-space variations.'),
('algorithms','deep','cp-algorithms: Disjoint Set Union (Union-Find)','https://cp-algorithms.com/data_structures/disjoint_set_union.html',
 'Union-Find with path compression and union by rank or size, the near-constant amortised complexity, and its use for connectivity, cycle detection and Kruskal minimum spanning trees.'),
('algorithms','deep','cp-algorithms: Breadth-first search','https://cp-algorithms.com/graph/breadth-first-search.html',
 'BFS on graphs and grids, why it yields shortest paths in unweighted graphs, and the queue-based level-order traversal pattern.'),
('algorithms','deep','cp-algorithms: Depth-first search','https://cp-algorithms.com/graph/depth-first-search.html',
 'DFS traversal, the edge classification it produces, and its use for cycle detection, connected components and topological ordering.'),
('algorithms','deep','cp-algorithms: Topological sort','https://cp-algorithms.com/graph/topological-sort.html',
 'Ordering a directed acyclic graph so every edge points forward, via DFS finish times or Kahn indegree peeling, and how it detects cycles.'),
('algorithms','deep','cp-algorithms: Dijkstra shortest paths','https://cp-algorithms.com/graph/dijkstra.html',
 'Single-source shortest paths on non-negative weights, the priority-queue implementation, and why negative edges break the greedy argument.'),
('algorithms','doc','Time complexity','https://en.wikipedia.org/wiki/Time_complexity',
 'Classifying algorithms by how running time grows with input size, the common classes from constant through linearithmic to exponential, and worst versus average case.'),
('algorithms','doc','Big O notation','https://en.wikipedia.org/wiki/Big_O_notation',
 'Asymptotic upper bounds and the related Omega and Theta notations, and how to reason about growth rates while ignoring constants.'),
('algorithms','doc','Binary search tree','https://en.wikipedia.org/wiki/Binary_search_tree',
 'The ordering invariant, search, insert and delete, why an unbalanced tree degrades to a linked list, and the self-balancing variants that prevent it.'),
('algorithms','doc','Hash table','https://en.wikipedia.org/wiki/Hash_table',
 'Hashing to buckets, collision resolution by chaining versus open addressing, load factor and resizing, and why average-case constant lookup degrades under adversarial keys.'),
('algorithms','doc','Linked list','https://en.wikipedia.org/wiki/Linked_list',
 'Singly and doubly linked lists, the pointer-manipulation patterns for insertion and deletion, and the trade-off against arrays on locality and random access.'),
('algorithms','doc','Cycle detection','https://en.wikipedia.org/wiki/Cycle_detection',
 'Floyd tortoise-and-hare and Brent algorithms for finding a cycle in constant space — the fast-and-slow-pointer technique behind the classic linked-list interview question.'),
('algorithms','doc','Stack (abstract data type)','https://en.wikipedia.org/wiki/Stack_(abstract_data_type)',
 'LIFO semantics, array and linked implementations, and the problems stacks solve: expression parsing, backtracking, and monotonic-stack range queries.'),
('algorithms','doc','Queue (abstract data type)','https://en.wikipedia.org/wiki/Queue_(abstract_data_type)',
 'FIFO semantics, circular buffer and linked implementations, deques, and the role of queues in BFS and in producer-consumer designs.'),
('algorithms','doc','Dynamic programming','https://en.wikipedia.org/wiki/Dynamic_programming',
 'Optimal substructure and overlapping subproblems, and the two ways to exploit them: top-down memoization and bottom-up tabulation.'),
('algorithms','doc','Memoization','https://en.wikipedia.org/wiki/Memoization',
 'Caching function results by arguments, how it converts exponential recursion to polynomial time, and how it differs from tabulation in evaluation order and space.'),
('algorithms','doc','Greedy algorithm','https://en.wikipedia.org/wiki/Greedy_algorithm',
 'Making the locally optimal choice, the matroid and exchange-argument conditions under which that is globally optimal, and why greedy fails without them.'),
('algorithms','doc','Sorting algorithm','https://en.wikipedia.org/wiki/Sorting_algorithm',
 'Comparison sorts and their bounds, stability, in-place versus auxiliary space, and why quicksort, mergesort and heapsort are chosen in different situations.'),
('algorithms','doc','Prefix sum','https://en.wikipedia.org/wiki/Prefix_sum',
 'Precomputing cumulative sums to answer range queries in constant time, and its extension to difference arrays and two-dimensional grids.'),
('algorithms','doc','Cache replacement policies','https://en.wikipedia.org/wiki/Cache_replacement_policies',
 'LRU, LFU, FIFO and ARC eviction strategies, their hit-rate behaviour, and the hash-map-plus-doubly-linked-list structure behind an O(1) LRU cache.'),
('algorithms','doc','Bloom filter','https://en.wikipedia.org/wiki/Bloom_filter',
 'A probabilistic set membership structure with no false negatives but tunable false positives, and its use to avoid expensive lookups in databases and caches.'),

-- =========================================================================
-- databases — relational internals, modelling, NoSQL
-- =========================================================================
('databases','doc','PostgreSQL: Transaction Isolation','https://www.postgresql.org/docs/current/transaction-iso.html',
 'The SQL isolation levels as actually implemented: which anomalies each prevents — dirty read, non-repeatable read, phantom, write skew — and what serializable snapshot isolation costs.'),
('databases','doc','PostgreSQL: Index Types','https://www.postgresql.org/docs/current/indexes-types.html',
 'B-tree, hash, GiST, GIN and BRIN indexes, the query shapes each one serves, and why the default B-tree answers equality, range and ordering while a hash index answers only equality.'),
('databases','deep','PostgreSQL: Using EXPLAIN','https://www.postgresql.org/docs/current/using-explain.html',
 'Reading a query execution plan: scan and join node types, estimated versus actual rows, and how to tell that the planner chose a sequential scan because a predicate was not sargable.'),
('databases','doc','PostgreSQL: Multiversion Concurrency Control','https://www.postgresql.org/docs/current/mvcc-intro.html',
 'How MVCC lets readers avoid blocking writers by keeping row versions, and the consequences: snapshot visibility rules and vacuum.'),
('databases','doc','ACID','https://en.wikipedia.org/wiki/ACID',
 'Atomicity, consistency, isolation and durability — what each actually guarantees, and which are relaxed by distributed and NoSQL systems and why.'),
('databases','doc','Database normalization','https://en.wikipedia.org/wiki/Database_normalization',
 'Normal forms from 1NF to BCNF, the update, insert and delete anomalies they remove, and functional dependencies as the underlying reasoning.'),
('databases','doc','Denormalization','https://en.wikipedia.org/wiki/Denormalization',
 'Deliberately reintroducing redundancy to cut join cost on read-heavy workloads, and the write-amplification and consistency price that comes with it.'),
('databases','doc','B-tree','https://en.wikipedia.org/wiki/B-tree',
 'The balanced, high-fanout structure behind most database indexes: why shallow trees minimise disk seeks, and how splits and merges keep it balanced.'),
('databases','doc','Shard (database architecture)','https://en.wikipedia.org/wiki/Shard_(database_architecture)',
 'Horizontal partitioning across nodes, choosing a shard key, hot-spot and rebalancing problems, and why cross-shard joins and transactions get expensive.'),
('databases','doc','Replication (computing)','https://en.wikipedia.org/wiki/Replication_(computing)',
 'Leader-follower and multi-leader replication, synchronous versus asynchronous, and replication lag with the read-your-own-writes problem it creates.'),
('databases','doc','CAP theorem','https://en.wikipedia.org/wiki/CAP_theorem',
 'Why a partitioned system must choose between consistency and availability, what the theorem does not say about the non-partitioned case, and the PACELC refinement.'),
('databases','doc','Eventual consistency','https://en.wikipedia.org/wiki/Eventual_consistency',
 'The convergence guarantee, the anomalies it permits in the meantime, and stronger session guarantees such as read-your-writes and monotonic reads.'),
('databases','doc','Document-oriented database','https://en.wikipedia.org/wiki/Document-oriented_database',
 'Storing semi-structured documents rather than rows, schema flexibility, and the aggregate-boundary modelling that replaces joins.'),
('databases','doc','Key-value database','https://en.wikipedia.org/wiki/Key%E2%80%93value_database',
 'The simplest data model, its scaling properties, and why access-pattern-first design is mandatory when there is no query planner.'),
('databases','doc','Graph database','https://en.wikipedia.org/wiki/Graph_database',
 'Nodes, edges and properties as first-class citizens, index-free adjacency, and the traversal queries that are impractical as recursive SQL joins.'),
('databases','doc','AWS: NoSQL design for DynamoDB','https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-general-nosql-design.html',
 'Designing for access patterns rather than normal forms: partition and sort keys, why you enumerate queries before the schema, and how that inverts relational habits.'),
('databases','deep','AWS: from relational modelling to single-table design','https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-relational-modeling.html',
 'Collapsing a relational schema into one DynamoDB table with overloaded keys and secondary indexes — the reasoning behind single-table design and what it costs in readability.'),
('databases','doc','Two-phase commit protocol','https://en.wikipedia.org/wiki/Two-phase_commit_protocol',
 'Coordinating an atomic commit across nodes, the prepare and commit phases, and the blocking behaviour on coordinator failure that motivates sagas.'),

-- =========================================================================
-- distributed-systems — consensus, scaling, resiliency patterns
-- =========================================================================
('distributed-systems','deep','Raft consensus algorithm','https://raft.github.io/',
 'Consensus decomposed into leader election, log replication and safety, designed to be understandable where Paxos is not. The protocol behind etcd, Consul and many replicated stores.'),
('distributed-systems','doc','Paxos','https://en.wikipedia.org/wiki/Paxos_(computer_science)',
 'The classical consensus family: proposers, acceptors and learners, the two-phase protocol, and why a majority quorum gives safety under asynchrony.'),
('distributed-systems','deep','Consistent hashing','https://en.wikipedia.org/wiki/Consistent_hashing',
 'Mapping keys to nodes on a ring so adding or removing a node moves only a small fraction of keys, plus virtual nodes for balance. The basis of distributed caches and sharded stores.'),
('distributed-systems','deep','microservices.io: Circuit Breaker','https://microservices.io/patterns/reliability/circuit-breaker.html',
 'Failing fast when a dependency is unhealthy: the closed, open and half-open states, and how it stops a slow dependency from exhausting the caller thread pool and cascading.'),
('distributed-systems','deep','Martin Fowler: CircuitBreaker','https://martinfowler.com/bliki/CircuitBreaker.html',
 'The original write-up with the state machine and the reasoning: why timeouts alone are insufficient, and what to return while the breaker is open.'),
('distributed-systems','deep','microservices.io: Saga','https://microservices.io/patterns/data/saga.html',
 'Maintaining consistency across services without a distributed transaction: a sequence of local transactions with compensating actions, and choreography versus orchestration.'),
('distributed-systems','deep','microservices.io: API Gateway','https://microservices.io/patterns/apigateway.html',
 'A single entry point that routes, composes and translates for clients, the backend-for-frontend variant, and the risk of the gateway becoming a bottleneck or a monolith.'),
('distributed-systems','deep','microservices.io: Service Registry','https://microservices.io/patterns/service-registry.html',
 'A database of service instances and their locations, how registration and health checking work, and why static configuration fails with dynamic instances.'),
('distributed-systems','deep','microservices.io: Client-side discovery','https://microservices.io/patterns/client-side-discovery.html',
 'Letting the client query the registry and load balance itself, versus server-side discovery behind a router — the trade-off in coupling and operational complexity.'),
('distributed-systems','deep','Azure Architecture: Bulkhead pattern','https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead',
 'Isolating resources into pools so one failing dependency cannot consume every connection or thread — containment of failure rather than prevention.'),
('distributed-systems','deep','Azure Architecture: Retry pattern','https://learn.microsoft.com/en-us/azure/architecture/patterns/retry',
 'Which failures are worth retrying, why retries need idempotency, and how retry storms make an outage worse without backoff and a cap.'),
('distributed-systems','deep','AWS Builders Library: timeouts, retries and backoff with jitter','https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter',
 'Why naive exponential backoff still synchronises clients into thundering herds, and how jitter spreads retries. Includes choosing timeouts and bounding total attempts.'),
('distributed-systems','doc','Load balancing (computing)','https://en.wikipedia.org/wiki/Load_balancing_(computing)',
 'Distributing traffic across servers: round robin, least connections and hashing, health checks, session affinity, and the difference between L4 transport and L7 application balancing.'),
('distributed-systems','doc','Reverse proxy','https://en.wikipedia.org/wiki/Reverse_proxy',
 'A server that fronts backends for TLS termination, caching, compression, routing and protection — and how it differs from a forward proxy and from an API gateway.'),
('distributed-systems','doc','Rate limiting','https://en.wikipedia.org/wiki/Rate_limiting',
 'Bounding request rates to protect a service: token bucket, leaky bucket and fixed or sliding windows, and where the counter lives in a distributed deployment.'),
('distributed-systems','doc','Idempotence','https://en.wikipedia.org/wiki/Idempotence',
 'Operations safe to apply more than once, why it is the precondition for retries and at-least-once delivery, and how idempotency keys deduplicate requests.'),

-- =========================================================================
-- messaging — queues, streams, delivery semantics
-- =========================================================================
('messaging','doc','Apache Kafka: introduction','https://kafka.apache.org/intro/',
 'Topics, partitions, offsets, producers, consumers and consumer groups — the log-based model, and how partitioning provides both ordering within a key and parallelism across keys.'),
('messaging','deep','Apache Kafka: documentation','https://kafka.apache.org/documentation/',
 'The reference: replication and in-sync replicas, delivery semantics from at-most-once through exactly-once, consumer group rebalancing, offset commits and retention.'),
('messaging','doc','RabbitMQ: dead letter exchanges','https://www.rabbitmq.com/docs/dlx',
 'Where messages go when rejected, expired or over-length — the dead letter queue mechanism, and using it for poison-message handling and retry with delay.'),
('messaging','doc','Publish-subscribe pattern','https://en.wikipedia.org/wiki/Publish%E2%80%93subscribe_pattern',
 'Decoupling senders from receivers through topics, how it differs from point-to-point queues, and the delivery and filtering guarantees it does and does not provide.'),
('messaging','doc','Message broker','https://en.wikipedia.org/wiki/Message_broker',
 'Brokered messaging: routing, transformation and buffering between services, and the distinction between a traditional broker and an event streaming log.'),

-- =========================================================================
-- caching — distributed cache design
-- =========================================================================
('caching','doc','Redis: data types','https://redis.io/docs/latest/develop/data-types/',
 'Strings, hashes, lists, sets, sorted sets, streams and bitmaps, with the operations and complexity of each — and choosing the structure that makes the access pattern cheap.'),
('caching','deep','Redis: cluster specification','https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/',
 'Hash slots, resharding, replication and failover in Redis Cluster, and the consistency guarantees a distributed cache does and does not offer.'),
('caching','deep','AWS Builders Library: caching challenges and strategies','https://aws.amazon.com/builders-library/caching-challenges-and-strategies/',
 'Cache invalidation, stampedes and thundering herds, negative caching, TTL jitter, and how a cache changes the failure modes of the system behind it.'),

-- =========================================================================
-- auth — identity, tokens, transport security
-- =========================================================================
('auth','spec','RFC 6749: The OAuth 2.0 Authorization Framework','https://www.rfc-editor.org/rfc/rfc6749.html',
 'The normative OAuth 2.0 specification: roles, the authorization code and client credentials grants, access and refresh tokens, and scopes.'),
('auth','spec','OpenID Connect Core 1.0','https://openid.net/specs/openid-connect-core-1_0.html',
 'The identity layer on top of OAuth 2.0: ID tokens, the UserInfo endpoint, and why OAuth alone is authorization rather than authentication.'),
('auth','spec','RFC 7519: JSON Web Token (JWT)','https://www.rfc-editor.org/rfc/rfc7519.html',
 'JWT structure — header, payload and signature — registered claims such as exp, iss and aud, and the validation steps that must not be skipped, including algorithm confusion.'),
('auth','doc','OAuth.net: refresh tokens','https://oauth.net/2/refresh-tokens/',
 'Obtaining new access tokens without re-authenticating, refresh token rotation and reuse detection, and why short-lived access tokens plus rotation limit the blast radius of a leak.'),
('auth','doc','Role-based access control','https://en.wikipedia.org/wiki/Role-based_access_control',
 'Assigning permissions to roles and roles to users, role hierarchies and separation of duty, and how RBAC compares with attribute-based access control.'),
('auth','doc','MDN: Transport Layer Security','https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Transport_Layer_Security',
 'What TLS provides — confidentiality, integrity and authentication — the handshake at a high level, certificates and cipher suites, and TLS versions in practice.'),
('auth','spec','RFC 8446: TLS 1.3','https://www.rfc-editor.org/rfc/rfc8446.html',
 'The normative TLS 1.3 specification: the reduced one-round-trip handshake, key exchange and session resumption with pre-shared keys, and the legacy features it removed.'),

-- =========================================================================
-- observability — logs, traces, metrics, SLOs
-- =========================================================================
('observability','doc','OpenTelemetry: what is OpenTelemetry','https://opentelemetry.io/docs/what-is-opentelemetry/',
 'The vendor-neutral standard for telemetry: the API, SDK and collector, and why decoupling instrumentation from the backend avoids re-instrumenting on every tooling change.'),
('observability','deep','OpenTelemetry: traces','https://opentelemetry.io/docs/concepts/signals/traces/',
 'Spans, trace context and propagation across service boundaries — how a single request is reconstructed end to end in a distributed system.'),
('observability','doc','OpenTelemetry: metrics','https://opentelemetry.io/docs/concepts/signals/metrics/',
 'Counters, gauges and histograms, aggregation temporality, and the cardinality problem that makes attribute choice a cost decision.'),
('observability','doc','OpenTelemetry: logs','https://opentelemetry.io/docs/concepts/signals/logs/',
 'Structured, correlated logging: attaching trace and span context to log records so logs, traces and metrics describe the same request.'),
('observability','deep','Google SRE: Service Level Objectives','https://sre.google/sre-book/service-level-objectives/',
 'SLIs, SLOs and SLAs, choosing indicators that reflect user experience, and error budgets as the mechanism that converts reliability into a decision about shipping.'),
('observability','deep','Google SRE: Monitoring Distributed Systems','https://sre.google/sre-book/monitoring-distributed-systems/',
 'The four golden signals — latency, traffic, errors, saturation — symptom-based versus cause-based alerting, and why paging on causes produces noise.'),

-- =========================================================================
-- api-design — REST, gRPC, GraphQL, versioning
-- =========================================================================
('api-design','spec','RFC 9110: HTTP Semantics','https://www.rfc-editor.org/rfc/rfc9110.html',
 'The normative definition of HTTP methods, status codes, headers and content negotiation, including the safety and idempotency properties REST design depends on.'),
('api-design','doc','REST','https://en.wikipedia.org/wiki/REST',
 'The architectural constraints — uniform interface, statelessness, cacheability, layered system — and what distinguishes REST from an arbitrary JSON-over-HTTP API.'),
('api-design','doc','gRPC: introduction','https://grpc.io/docs/what-is-grpc/introduction/',
 'Contract-first RPC with protocol buffers over HTTP/2: unary and streaming calls, code generation, and the trade-off against REST on browser support and human debuggability.'),
('api-design','doc','GraphQL: schemas and types','https://graphql.org/learn/schema/',
 'The type system: object types, interfaces, unions, enums and non-null, and how the schema becomes the contract between client and server.'),
('api-design','deep','GraphQL: execution and resolvers','https://graphql.org/learn/execution/',
 'How a query is resolved field by field, the N+1 problem this creates, and batching with a data loader as the standard mitigation.'),
('api-design','deep','Azure Architecture: API design best practices','https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design',
 'Resource modelling, HTTP method and status usage, filtering and pagination, versioning strategies (URI, header, media type), and handling partial responses and large payloads.'),

-- =========================================================================
-- infrastructure — DNS, real-time transport
-- =========================================================================
('infrastructure','doc','Domain Name System','https://en.wikipedia.org/wiki/Domain_Name_System',
 'How a name is resolved: recursive and authoritative resolvers, the root and TLD hierarchy, record types, TTL and caching, and geographic and latency-based routing.'),
('infrastructure','doc','MDN: WebRTC API','https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API',
 'Peer-to-peer audio, video and data in the browser: signalling, ICE with STUN and TURN for NAT traversal, and data channels as an alternative to server-relayed transport.')

on conflict (url) do nothing;
