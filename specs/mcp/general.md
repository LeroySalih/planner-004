# MCP General Spec



## Ports
- The main MCP server will run on /api/MCP

## Auth
- The MCP server will connect to the supbase usign the service role key, specified as SUPABASE_SERVICE_ROLE_KEY in the .env file.
- Authorization is through the headers.  The MCP request  must contain the value that is specified in MCP_SERVICE_KEY

## Discovery
- `GET /api/MCP` returns a JSON payload describing the available tools.  
  ```
  {
      tools: [
          { name: string, method: string, path: string, description: string }
      ]
  }
  ```
