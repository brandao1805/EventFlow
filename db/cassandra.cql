CREATE KEYSPACE IF NOT EXISTS eventflow WITH replication = {'class':'NetworkTopologyStrategy','datacenter1':1};
CREATE TABLE IF NOT EXISTS eventflow.events_by_id (id text PRIMARY KEY, payload text);
CREATE TABLE IF NOT EXISTS eventflow.events_by_month (
 month text, starts_at text, id text, payload text,
 PRIMARY KEY ((month), starts_at, id)
) WITH CLUSTERING ORDER BY (starts_at ASC, id ASC);
