# MCP Spec for Curriculum.


## Description
The Curriculum MCP server allows LLMs to interact with the Curriculum.


## Tools for Curriculum MCP Service.

- get_all_curriculum.  This method will not accpet anything, and will return a list of all curriculum.  The return will be JSON, in the following format.
```
[
    {curriculum_id: string, title: string, is_active: boolean}
]
```


- get_curriculum.  This service will accept a valid curriculum id and return a single curriculum.  The return is JSON format:

```
{curriculum_id: string, title: string}, is_active: boolean
```