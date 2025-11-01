# MCP Spec for Curriculum.


## Description
The Curriculum MCP server allows LLMs to interact with the Curriculum.


## Tools for Curriculum MCP Service.

- get_all_curriculum.  This endpoint accepts both `GET` and `POST` and returns a streamed JSON response listing all curriculum.  The return format is:
```
[
    {curriculum_id: string, title: string, is_active: boolean}
]
```


- get_curriculum.  This endpoint accepts both `GET` and `POST`, requires a valid curriculum id, and returns a streamed JSON response for a single curriculum.  The return format is:

```
{curriculum_id: string, title: string}, is_active: boolean
```
