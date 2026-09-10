# Traefik — reverse proxy (dev local)

Traefik route chaque domaine vers le container du site correspondant. Il ne lit
**aucun label Docker** : sa configuration dynamique est servie par l'Agent
(`GET /traefik/config`, HTTP Provider, poll toutes les 2 s).

## Démarrage

```bash
cd docker/traefik
cp .env.example .env          # renseigner AGENT_TOKEN (identique à apps/agent/.env)
docker compose up -d
```

Prérequis (une seule fois) :

```bash
# réseaux — l'Agent les crée aussi à son premier démarrage
docker network create hosting-proxy
docker network create hosting-sites
# volume des certificats (déclaré `external` pour survivre à `compose down -v`)
docker volume create hosting-traefik-acme
```

## Vérifier

```bash
docker compose logs -f traefik
curl -H "Host: <site>.localhost" http://localhost/
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `compose.yaml` | définition du container `hosting-traefik` |
| `.env` | `AGENT_TOKEN` (non versionné) |
| `dynamic.json` | **état runtime écrit par l'Agent** — non versionné, recréé au besoin |

Le volume `hosting-traefik-acme` conserve les certificats Let's Encrypt entre
les redémarrages.

## VPS

Le Traefik du VPS est déployé séparément. `host.docker.internal` y est résolu
via `host-gateway` (déjà dans `compose.yaml`) et l'accès à l'Agent sur le port
4000 est ouvert par la règle UFW `4000/tcp ALLOW IN 172.18.0.0/16`.
