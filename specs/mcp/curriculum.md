# MCP Spec for Curriculum.


## Description
The Curriculum MCP server allows LLMs to interact with the Curriculum.


## Tools for Curriculum MCP Service.

- get_all_curriculum.  This endpoint accepts both `GET` and `POST` and returns a list of all curriculum.  The return will be JSON, in the following format.
```
[
    {curriculum_id: string, title: string, is_active: boolean}
]
```


- get_curriculum.  This endpoint accepts both `GET` and `POST`, requires a valid curriculum id, and returns a single curriculum.  The return is JSON format:

```
{curriculum_id: string, title: string}, is_active: boolean
```
