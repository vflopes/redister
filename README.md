# Redister

**What is Redister?**

Redister is an alternative to other Redis Cluster management tools and a solution to scale Redis Cluster using Docker without any human intervention. It works using NodeJS scripts to manage the cluster, so the Redister image is built from Redis official images with NodeJS addition.

**What will run in Redister?**

* A NodeJS app which manages a instantiates the redis-server process
* A standalone Redis used by Redister to store cluster state and quorum agreements
* A clustered Redis to join the Redis cluster

**How Redister knows about other nodes in the cluster?**

The discovery is based on HTTP requests that provides health information about a node. Redister uses three strategies to discover other nodes:
* DNS name resolving (service names in Docker Stack/Kubernetes)
* Peers from peers: agregate peers discovered by other peers
* Round-robin requests: doing requests to the hostname the node will receive responses from all endpoints and each request will reach an existing or new peer, this logic is used to update the peers list

**How they choose a leader?**

There's a script named **quorum.js** the algorithm used by Redister is based on "alpha selection" for leader:
* A node must lock a flag on other nodes (standalone Redis) and keep the TTL of this flag up to date
* The node must have a high random integer stamp greater than 50% of other nodes
* The node must have the leadership of the majority nodes

And other minor logics that makes the quorum fast as light speed to choose a leader.

**Redister supports persistence?**

Yes, but only AOF. Redister will use AOF to replay all commads into Redis Cluster using redis-cli. This is slow, but is the most secure way to have an aproximation of zero data loss in Redis Cluster.

**Can I change the number of replicas on the fly?**

Yes, you can. But this action must be done through an HTTP request. The endpoint used to change the number of replicas is the same used to force a known cluster size by Redister nodes.