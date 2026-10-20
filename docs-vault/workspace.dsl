/*
 * Satis Manager architecture model (ADR-0024: the single source of truth for diagrams).
 * Elements tagged "planned" are not built yet; their ADR triggers are in docs-vault/wiki/decisions.
 * Components carry a "code" property naming their backend/src/modules folder; the CI drift check
 * compares these relationships with the real import graph (ADR-0024 phase 3).
 */
workspace "Satis Manager" "Live monitoring dashboard for Satisfactory dedicated servers." {

    !identifiers hierarchical

    configuration {
        scope softwaresystem
    }

    model {
        owner = person "Server owner" "Runs a Satisfactory dedicated server and monitors it from the dashboard."
        player = person "Player" "Any signed-in user; may own or be a member of several servers (ADR-0020)." "planned"

        github = softwareSystem "GitHub" "Source, pull-request reviews, CI (lint, tests, e2e, CodeQL, PII scan)." "External"
        google = softwareSystem "Google Sign-In" "OpenID Connect identity provider (ADR-0020)." "External,planned"

        game = softwareSystem "Satisfactory dedicated server" "The game server: its HTTPS API (:7777, token enforced) and the Ficsit Remote Monitoring (FRM) mod's HTTP API (:8080, loopback only)." "External"

        satis = softwareSystem "Satis Manager" "Shows live status, power and factory data and toggles auto-pause." {
            spa = container "Web app" "Login, status, power (with 5-minute history), factory and settings views." "React, TypeScript, Vite, TanStack Query" "Web Browser"

            api = container "Backend API" "Authenticated REST API; validates every response against the shared zod contract." "Node.js, Express, TypeScript" {
                root = component "Composition root" "Wires modules, starts background workers, graceful shutdown." "app.ts, server.ts"
                platform = component "platform" "Logger, error taxonomy, request ids, sendValidated, CSRF and JSON-only policy." "TypeScript" {
                    properties {
                        "code" "platform"
                    }
                }
                identity = component "identity" "Login, signed sessions, logout denylist, login rate limits." "TypeScript" {
                    properties {
                        "code" "modules/identity"
                    }
                }
                servers = component "servers" "Server registry and request scoping (ServerDirectory)." "TypeScript" {
                    properties {
                        "code" "modules/servers"
                    }
                }
                telemetry = component "telemetry" "Status, power, factory; power-history poller and ring buffer; item-unit catalog." "TypeScript" {
                    properties {
                        "code" "modules/telemetry"
                    }
                }
                settings = component "settings" "Auto-pause toggle: allowlisted read and write, lost-write read-back." "TypeScript" {
                    properties {
                        "code" "modules/settings"
                    }
                }
                alerts = component "alerts" "Alert engine: rule state machines, suppression, grouping; records alert events (delivery comes later)." "TypeScript" {
                    properties {
                        "code" "modules/alerts"
                    }
                }
                agents = component "agents" "Edge agent enrolment, credentials and snapshot ingest (ADR-0031 PR 5a); the owner's enrolment code, agent status and revoke." "TypeScript" {
                    properties {
                        "code" "modules/agents"
                    }
                }
                map = component "map" "World map: live world store, local-server world poller and world ingest, with their routes and repository." "TypeScript" {
                    properties {
                        "code" "modules/map"
                    }
                }
                gameserver = component "gameserver" "Thin facade over the game-adapter package, plus the backend-only config (environment and servers file); no Express." "TypeScript" {
                    properties {
                        "code" "modules/gameserver"
                    }
                }
            }

            gameAdapter = container "game-adapter package" "packages/game-adapter (ADR-0031 PR 2): the vanilla HTTPS API and FRM clients, raw zod schemas and the adapter for ONE game server. Imports only shared, zod and node; the backend uses it through gameserver, and the edge agent uses it directly." "TypeScript"
            agent = container "Edge agent" "agent/ (ADR-0031 PR 6): runs beside a player's game server on Windows; reads it over loopback with the game-adapter package, pushes snapshots outbound and executes commands. Secrets stored with DPAPI; imports only shared, game-adapter, zod and node." "Node.js, TypeScript"
            database = container "Database" "Users, sessions, servers, memberships, audit events (ADR-0025); latest snapshots and commands later (ADR-0020)." "PostgreSQL 18" "Database"
            provisioning = container "Provisioning service" "Creates and manages paid game servers as async jobs (ADR-0014)." "Node.js, TypeScript" "planned"
        }

        # Current relationships
        owner -> satis.spa "Uses" "HTTPS"
        satis.spa -> satis.api "Calls the API" "HTTPS JSON, HttpOnly session cookie"
        satis.api -> game "Reads server state; writes auto-pause" "Game HTTPS API :7777, application token" "direct-game-access"
        satis.api -> game "Reads factory, power and buildings" "FRM HTTP API :8080 (loopback), FRM token" "direct-game-access"
        github -> satis "Builds, tests and deploys" "GitHub Actions, Workers Builds"

        satis.spa -> satis.api.identity "Signs in / out" "HTTPS JSON"
        satis.spa -> satis.api.telemetry "Reads status, power, history, factory" "HTTPS JSON"
        satis.spa -> satis.api.settings "Reads and toggles auto-pause" "HTTPS JSON"
        satis.spa -> satis.api.servers "Discovers servers" "HTTPS JSON"
        satis.api.root -> satis.api.identity "Wires" "In-process call" "wiring"
        satis.api.root -> satis.api.servers "Wires" "In-process call" "wiring"
        satis.api.root -> satis.api.telemetry "Wires" "In-process call" "wiring"
        satis.api.root -> satis.api.settings "Wires" "In-process call" "wiring"
        satis.api.root -> satis.api.alerts "Wires" "In-process call" "wiring"
        satis.api.alerts -> satis.api.telemetry "Reads the pollers' last readings" "In-process call"
        satis.api.alerts -> satis.api.servers "Lists the servers" "In-process call"
        satis.api.alerts -> satis.api.platform "Uses" "In-process call" "platform-use"
        satis.api.root -> satis.api.agents "Wires" "In-process call" "wiring"
        satis.api.agents -> satis.api.telemetry "Hands each snapshot to an agent server's telemetry services" "In-process call"
        satis.api.agents -> satis.api.servers "Switches a server to the agent connection kind" "In-process call"
        satis.api.agents -> satis.api.platform "Uses" "In-process call" "platform-use"
        satis.api.root -> satis.api.gameserver "Wires" "In-process call" "wiring"
        satis.api.root -> satis.api.map "Wires" "In-process call" "wiring"
        satis.api.map -> satis.api.gameserver "Reads the mapped world types" "In-process call"
        satis.api.map -> satis.api.servers "Resolves the requested server" "In-process call"
        satis.api.map -> satis.api.platform "Uses" "In-process call" "platform-use"
        satis.api.telemetry -> satis.api.gameserver "Reads through ports" "In-process call"
        satis.api.telemetry -> satis.api.servers "Resolves the requested server" "In-process call"
        satis.api.settings -> satis.api.gameserver "Reads and writes via ServerOptionsPort" "In-process call"
        satis.api.settings -> satis.api.servers "Resolves the requested server" "In-process call"
        satis.api.identity -> satis.api.platform "Uses" "In-process call" "platform-use"
        satis.api.servers -> satis.api.platform "Uses" "In-process call" "platform-use"
        satis.api.telemetry -> satis.api.platform "Uses" "In-process call" "platform-use"
        satis.api.settings -> satis.api.platform "Uses" "In-process call" "platform-use"
        satis.api.gameserver -> satis.api.platform "Uses error types" "In-process call" "platform-use"
        satis.api.root -> satis.api.platform "Uses" "In-process call" "platform-use"
        satis.api.gameserver -> satis.gameAdapter "Uses" "In-process call"
        satis.agent -> satis.gameAdapter "Uses" "In-process call"
        satis.gameAdapter -> game "Calls the game and FRM APIs" "HTTPS :7777, HTTP :8080 (loopback)"

        # Planned relationships (ADR-0014, ADR-0017, ADR-0020)
        player -> satis.spa "Uses" "HTTPS" "planned"
        satis.api -> google "Signs users in" "OpenID Connect" "planned"
        satis.api -> satis.database "Reads and writes" "SQL over TCP"
        satis.agent -> satis.api "Pushes snapshots; polls commands" "HTTPS, outbound only"
        satis.agent -> game "Reads state and data; applies commands" "HTTPS and HTTP (loopback)"
        satis.provisioning -> satis.database "Records provisioning jobs" "SQL" "planned"
        satis.provisioning -> game "Creates and starts managed servers" "AWS APIs" "planned"

        # Since the cut-over (ADR-0034 §7, #217); the facts are runbooks/aws.md and infra/aws/.
        deploymentEnvironment "Today" {
            cloudflare = deploymentNode "Cloudflare" "Edge network: static hosting, TLS, WAF." "Cloudflare" {
                workers = deploymentNode "Workers static assets" "satis-manager.com; SPA fallback; strict CSP; deployed on every merge to main." "Cloudflare Workers" {
                    spaInstance = containerInstance satis.spa
                }
                edge = infrastructureNode "api.satis-manager.com" "TLS termination; WAF login rate limit; the tunnel's one public-hostname rule." "Cloudflare Tunnel"
            }
            amazon = deploymentNode "AWS" "Owner's account on the Free plan, time-boxed with a rehearsed exit (ADR-0034). Terraform in infra/aws/." "Amazon Web Services" {
                vpc = deploymentNode "VPC" "Public subnets only: no NAT gateway, no load balancer, no inbound security-group rules." "Amazon VPC" {
                    task = deploymentNode "ECS Fargate task" "Service satis-prod: one ARM task (0.5 vCPU, 1 GB); a public IP for outbound traffic only." "AWS Fargate" {
                        tunnel = infrastructureNode "cloudflared" "Sidecar; outbound-only tunnel to Cloudflare." "Cloudflare Tunnel"
                        apiInstance = containerInstance satis.api
                    }
                    db = deploymentNode "RDS" "db.t4g.micro, single-AZ; not publicly accessible, port 5432 open to the task's security group only." "Amazon RDS for PostgreSQL 18" {
                        dbInstance = containerInstance satis.database
                    }
                    ops = infrastructureNode "Ops tasks" "One-off ECS tasks on the ops image: db-init, db-migrate, restore, and the nightly backup (pg_dump, encrypted with age)." "AWS Fargate"
                }
                scheduler = infrastructureNode "EventBridge Scheduler" "Starts the backup ops task nightly." "Amazon EventBridge Scheduler"
                ssm = infrastructureNode "SSM Parameter Store" "/satis/prod/* SecureStrings, read by each task's execution role at start; no task holds AWS credentials." "AWS Systems Manager"
                masterSecret = infrastructureNode "Secrets Manager" "The RDS master password, kept by RDS; only the db-init ops task reads it." "AWS Secrets Manager"
            }
            b2 = deploymentNode "Backblaze B2" "Off-site: a different provider from the hosting (ADR-0035)." "Backblaze" {
                bucket = infrastructureNode "Backup bucket" "Private; Object Lock, 30 days; encrypted dumps kept up to 37 days." "Backblaze B2"
            }
            pc = deploymentNode "Owner's gaming PC" "Runs only the game and the edge agent; no inbound ports open." "Windows" {
                agentNode = deploymentNode "Edge agent" "Scheduled Task; outbound only; secrets stored with DPAPI (ADR-0031)." "Node.js" {
                    agentInstance = containerInstance satis.agent
                }
                gameNode = deploymentNode "Dedicated server process" "Game server with the FRM mod; FRM listens on loopback only." "Satisfactory 1.x" {
                    gameInstance = softwareSystemInstance game
                }
            }
            cloudflare.edge -> amazon.vpc.task.tunnel "Routes API traffic over the tunnel cloudflared opened" "Cloudflare Tunnel"
            amazon.vpc.task.tunnel -> amazon.vpc.task.apiInstance "Forwards" "HTTP (127.0.0.1:3001)"
            amazon.ssm -> amazon.vpc.task "Injects /satis/prod/* as environment variables" "ECS execution role"
            amazon.masterSecret -> amazon.vpc.ops "Gives db-init the master password" "ECS execution role"
            amazon.scheduler -> amazon.vpc.ops "Starts the backup nightly" "ECS RunTask"
            amazon.vpc.ops -> amazon.vpc.db.dbInstance "Migrates; dumps with the backup role; restores" "SQL"
            amazon.vpc.ops -> b2.bucket "Uploads encrypted backups" "HTTPS (S3-compatible), upload-only key"
        }

        deploymentEnvironment "Target" {
            cloud = deploymentGroup "Cloud"
            managedGroup = deploymentGroup "Managed"
            selfGroup = deploymentGroup "Self-hosted"

            cloudflareT = deploymentNode "Cloudflare" "Edge network: static hosting, TLS, WAF." "Cloudflare" {
                workersT = deploymentNode "Workers static assets" "/app SPA and public pages." "Cloudflare Workers" {
                    containerInstance satis.spa "cloud"
                }
            }
            aws = deploymentNode "AWS" "Cloud hosting for the multi-user service." "Amazon Web Services" "planned" {
                ecs = deploymentNode "ECS" "Stateless API tasks" "Fargate" "planned" {
                    containerInstance satis.api "cloud,managedGroup,selfGroup"
                    containerInstance satis.provisioning "cloud,managedGroup"
                }
                rds = deploymentNode "RDS" "Managed PostgreSQL, one small instance (<=5,000 users)." "Amazon RDS for PostgreSQL" "planned" {
                    containerInstance satis.database "cloud"
                }
                secrets = infrastructureNode "Secrets Manager" "Per-server secrets for managed servers only (ADR-0017)." "AWS" "planned"
            }
            selfHosted = deploymentNode "User's network" "Self-hosted game server behind home NAT." "Home network" "planned" {
                selfHost = deploymentNode "Game host" "The user's PC or server running the game." "Windows or Linux" "planned" {
                    containerInstance satis.agent "selfGroup"
                    softwareSystemInstance game "selfGroup"
                }
            }
            managed = deploymentNode "Managed server" "Paid hosting; stopped when idle." "Amazon EC2" "planned" {
                managedAgent = containerInstance satis.agent "managedGroup"
                softwareSystemInstance game "managedGroup"
            }
            aws.secrets -> managed.managedAgent "Provides only its own secret" "IAM instance role" "planned"
        }
    }

    views {
        systemContext satis "Context" "Who uses Satis Manager and what it depends on, today." {
            include *
            exclude "element.tag==planned"
            autolayout lr
        }

        container satis "ContainersToday" "What is built and running today." {
            include *
            exclude "element.tag==planned"
            autolayout lr
        }

        container satis "ContainersTarget" "The planned multi-user architecture (ADR-0014, ADR-0020)." {
            include *
            autolayout lr
        }

        component satis.api "BackendModules" "Backend modular monolith; dependency rules are enforced by architecture.test.ts." {
            include *
            exclude "relationship.tag==wiring"
            exclude "relationship.tag==platform-use"
            exclude satis.api.root satis.api.platform
            autolayout tb
        }

        component satis.api "BackendModulesFull" "Every module dependency, including wiring and platform use (what the drift check compares)." {
            include *
            autolayout tb
        }

        deployment satis "Today" "DeploymentToday" "Deployed today: the backend on AWS, the agent on the game PC (ADR-0013, ADR-0031, ADR-0034, ADR-0035)." {
            include *
            exclude "relationship.tag==direct-game-access"
            autolayout lr 300 150
        }

        deployment satis "Target" "DeploymentTarget" "Planned deployment (ADR-0014, ADR-0017, ADR-0020)." {
            include *
            exclude "relationship.tag==direct-game-access"
            autolayout lr 300 150
        }

        styles {
            element "Element" {
                color #ffffff
                stroke #1f3a5f
            }
            element "Person" {
                shape person
                background #08427b
            }
            element "Software System" {
                background #1168bd
            }
            element "Container" {
                background #438dd5
            }
            element "Component" {
                background #85bbf0
                color #000000
            }
            element "Infrastructure Node" {
                background #ffffff
                color #000000
            }
            element "Deployment Node" {
                background #ffffff
                color #000000
            }
            element "Web Browser" {
                shape WebBrowser
            }
            element "Database" {
                shape cylinder
            }
            element "External" {
                background #8a8a8a
                color #ffffff
            }
            element "planned" {
                border dashed
                opacity 60
            }
            relationship "planned" {
                dashed true
                opacity 60
            }
        }
    }
}
