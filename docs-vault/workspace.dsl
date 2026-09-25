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
                gameserver = component "gameserver" "Vanilla and FRM clients, raw zod schemas; no Express (future edge agent)." "TypeScript" {
                    properties {
                        "code" "modules/gameserver"
                    }
                }
            }

            agent = container "Edge agent" "Runs beside each game server; pushes snapshots outbound and executes commands (ADR-0014/0017)." "Node.js, TypeScript" "planned"
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
        satis.api.root -> satis.api.gameserver "Wires" "In-process call" "wiring"
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
        satis.api.gameserver -> game "Calls the game and FRM APIs" "HTTPS :7777, HTTP :8080 (loopback)"

        # Planned relationships (ADR-0014, ADR-0017, ADR-0020)
        player -> satis.spa "Uses" "HTTPS" "planned"
        satis.api -> google "Signs users in" "OpenID Connect" "planned"
        satis.api -> satis.database "Reads and writes" "SQL over TCP (loopback)"
        satis.agent -> satis.api "Pushes snapshots; polls commands" "HTTPS, outbound only" "planned"
        satis.agent -> game "Reads state and data; applies commands" "HTTPS and HTTP (loopback)" "planned"
        satis.provisioning -> satis.database "Records provisioning jobs" "SQL" "planned"
        satis.provisioning -> game "Creates and starts managed servers" "AWS APIs" "planned"

        deploymentEnvironment "Today" {
            cloudflare = deploymentNode "Cloudflare" "Edge network: static hosting, TLS, WAF." "Cloudflare" {
                workers = deploymentNode "Workers static assets" "satis-manager.com; SPA fallback; strict CSP." "Cloudflare Workers" {
                    spaInstance = containerInstance satis.spa
                }
                edge = infrastructureNode "api.satis-manager.com" "TLS termination; WAF login rate limit." "Cloudflare"
            }
            pc = deploymentNode "Owner's gaming PC" "No inbound ports open." "Windows" {
                tunnel = infrastructureNode "cloudflared" "Outbound-only tunnel to Cloudflare." "Cloudflare Tunnel"
                node = deploymentNode "Node.js" "Scheduled Task; bound to 127.0.0.1:3001." "Node.js" {
                    apiInstance = containerInstance satis.api
                }
                gameNode = deploymentNode "Dedicated server process" "Game server with the FRM mod; auto-pause off by default." "Satisfactory 1.x" {
                    gameInstance = softwareSystemInstance game
                }
                pg = deploymentNode "PostgreSQL service" "Windows service; listens on loopback only." "PostgreSQL 18" {
                    dbInstance = containerInstance satis.database
                }
                backupTask = infrastructureNode "Nightly backup task" "pg_dump, encrypted with age on this PC (ADR-0025)." "Windows Scheduled Task"
            }
            backups = deploymentNode "AWS (backups only)" "Owner's AWS account." "Amazon Web Services" {
                s3 = infrastructureNode "S3 bucket" "Encrypted backups; versioned, 30 d + 7 d retention." "Amazon S3"
            }
            cloudflare.edge -> pc.tunnel "Routes API traffic" "Cloudflare Tunnel"
            pc.tunnel -> pc.node.apiInstance "Forwards" "HTTP (loopback)"
            pc.backupTask -> pc.pg.dbInstance "Dumps (read-only role)" "SQL (loopback)"
            pc.backupTask -> backups.s3 "Uploads encrypted backups" "HTTPS, put-only"
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

        deployment satis "Today" "DeploymentToday" "Deployed today (ADR-0013)." {
            include *
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
