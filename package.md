### 🧭 Local Reset Commands Overview

| Command | 🧩 Pulls Schema | 🗃️ Pulls Data | 💣 Wipes Local DB | 🍯 Imports Data |
|:--|:--:|:--:|:--:|:--:|
| **`npm run dev:fresh`** | ✅ | ❌ | ✅ | ❌ |
| **`npm run dev:fresh:data`** | ✅ | ✅ | ✅ | ✅ |

---

### 💡 Usage Notes

- **`dev:fresh`** → Rebuilds local database **structure only** (no data).  
- **`dev:fresh:data`** → Rebuilds local database **structure + contents**, fully mirroring remote.  
- Both commands automatically:
  - Stop and reset your local Supabase containers 🐳  
  - Drop and recreate the `public` schema 🧼  
  - Apply your latest `supabase/schemas/prod.sql` 🚀  