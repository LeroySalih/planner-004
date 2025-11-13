# MCP General Spec

This file describes the mcp service for dino.mr-salih.org

## Ports
- The main MCP server will run on /mcp

## Auth
- The MCP server will connect to the supbase using the service role key, specified as SUPABASE_SERVICE_ROLE_KEY in the .env file.
- Authorization is through the Bearer Auth.  The MCP request  must contain the value that is specified in MCP_SERVICE_KEY


## Discovery
- `GET /mcp` returns a JSON payload describing the available tools. `POST` is also accepted with an identical response body.  
  Responses are streamed using the HTTP Streamable transport (chunked JSON) to support long running tool discovery.  
  ```
  {
      tools: [
          { name: string, methods: string[], path: string, description: string }
      ]
  }
  ```
- Discovery and curriculum endpoints must support HTTP Streamable transport. Clients should expect chunked JSON responses rather than a single payload.
- MCP services should minimise database/network round trips when gathering data (prefer joined or batched queries).

## Tools
- `/mcp/curriculum` (GET/POST): curriculum summaries (all and by ID).
- `/mcp/losc` (GET/POST): curriculum learning objectives plus success criteria via `get_all_los_and_scs`.
- `/mcp/feedback/short-text` (POST): `feedback_short_text` tool that scores a short-text question, returns `{assignment_id, pupil_id, activity_id, ... score, feedback, populated_from_submission}`, auto-hydrates question/answer text from the latest submission when omitted, and persists every run into `short_text_feedback_events`.



## Tools for Curriculum MCP Service.

- get_all_curriculum.  This endpoint accepts `POST` and returns a streamed JSON response listing all curriculum.  The return format is:
```
[
    {curriculum_id: string, title: string, is_active: boolean}
]
```


- get_curriculum_id_from_title.  This endpoint will accept `POST` and recieves {curriculum_title: string}.  The curriculum title is matched using regex and may contain wildcard characters.  The return format is an array of matching curriculum: 
```
[
  {curriculum_id: string, curriculum_title: string}
]
```


- get_curriculum.  This endpoint accepts `POST`, requires a valid curriculum id, and returns a streamed JSON response for a single curriculum.  The return format is:

```
{curriculum_id: string, title: string}, is_active: boolean
```



# Tools for Learning Objectives and Success Criteria.


## Description
The Learning Objective and Success Criteria MCP server allows LLMs to interact with the Learning Objectives (LO) and Success Crierita (SC) for a given curriculum.  Curriculum may conatain many Learning Objectives and Learning Objectives may contain many Success Criteria.  Success criteria belong to a single Learning Objective.  Learning Objectives belong to a single unit.


## Tools for LO-SC MCP Service.

- get_all_los_and_scs_for_curriculum.  This endpoint accepts both `GET` and `POST` and returns a streamed JSON response listing all LO & Sc for a curriculum.  The input is the {curriculum_id: string}.

The return format is:
```
[
    {curriculum_id: string, title: string, is_active: boolean, learning_objectives: [ 
        {learning_objective_id: string, title: string, acitve: boolean, spec_ref: string, scs: [{success_criteria_id; string, title: string, active: string}]}
        ]}
]
```

