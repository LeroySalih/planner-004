# MCP Spec for Learning Objective and Success Criteria.


## Description
The Learning Objective and Success Criteria MCP server allows LLMs to interact with the Learning Objectives and Success Crierita for a given curriculum.


## Tools for LOSC MCP Service.

- get_all_los_and_scs.  This endpoint accepts both `GET` and `POST` and returns a streamed JSON response listing all curriculum.  The input is the {curricumul_id: string}.

The return format is:
```
[
    {curriculum_id: string, title: string, is_active: boolean, learning_objectives: [ 
        {learning_objective_id: string, title: string, acitve: boolean, spec_ref: string, scs: [{success_criteria_id; string, title: string, active: string}]}
        ]}
]
```


