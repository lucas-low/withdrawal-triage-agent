# 0007. Retrieval returns structured facts only

**Status:** accepted

**Context.** The agent can look up past cases that reviewers decided, which helps with patterns no rule covers. Anything the agent retrieves is another way for text to reach it.

**Decision.** A precedent stores a feature vector, the proposed action, the human outcome, rule ids, the amount and two profile facts. Reviewer comments are not stored in it. Similarity is cosine over a hand-built feature vector, with no learned embedding. Only decided proposals (approved or rejected) are added. Expired ones are not.

**Consequences.** Retrieved data cannot carry an instruction. The vector is inspectable and needs no model. Brute-force search is fine to about ten thousand cases, after which pgvector with an HNSW index is the path (docs/roadmap.md). The policy floor is unaffected by retrieval: precedents can make the agent stricter, and the floor still prevents it from being looser than policy.
