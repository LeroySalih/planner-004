
const fs = require('fs');

const data = {
  "specification": {
    "title": "Pearson Edexcel Level 1/Level 2 GCSE (9-1) in Design and Technology",
    "subject": "Design and Technology",
    "exam_board": "Pearson Edexcel",
    "level": "GCSE (9-1)"
  },
  "units": [
    {
      "number": "1",
      "title": "Core content",
      "key_ideas": [
        {
          "number": "1.1",
          "title": "The impact of new and emerging technologies",
          "description": "To apply a breadth of technical knowledge and understanding of the characteristics, advantages and disadvantages of the following in relation to new and emerging technologies.",
          "sub_items": [
            {
              "number": "1.1.1",
              "title": "Industry",
              "points": [
                { "label": "a", "content": "unemployment" },
                { "label": "b", "content": "workforce skill set" },
                { "label": "c", "content": "demographic movement" },
                { "label": "d", "content": "science and technology parks" }
              ]
            },
            {
              "number": "1.1.2",
              "title": "Enterprise",
              "points": [
                { "label": "a", "content": "privately-owned business" },
                { "label": "b", "content": "crowd funding" },
                { "label": "c", "content": "government funding for new business start-ups" },
                { "label": "d", "content": "not-for-profit organisations" }
              ]
            },
            {
              "number": "1.1.3",
              "title": "Sustainability",
              "points": [
                { "label": "a", "content": "transportation costs" },
                { "label": "b", "content": "pollution" },
                { "label": "c", "content": "demand on natural resources" },
                { "label": "d", "content": "waste generated" }
              ]
            },
            {
              "number": "1.1.4",
              "title": "People",
              "points": [
                { "label": "a", "content": "workforce" },
                { "label": "b", "content": "consumers" },
                { "label": "c", "content": "children" },
                { "label": "d", "content": "people with disabilities" },
                { "label": "e", "content": "wage levels" },
                { "label": "f", "content": "highly-skilled workforce" },
                { "label": "g", "content": "apprenticeships" }
              ]
            },
            {
              "number": "1.1.5",
              "title": "Culture",
              "points": [
                { "label": "a", "content": "population movement within the EU" },
                { "label": "b", "content": "social segregation/clustering within ethnic minorities" }
              ]
            },
            {
              "number": "1.1.6",
              "title": "Society",
              "points": [
                { "label": "a", "content": "changes in working hours and shift patterns" },
                { "label": "b", "content": "Internet of Things (IoT)" },
                { "label": "c", "content": "remote working" },
                { "label": "d", "content": "use of video conference meetings" }
              ]
            },
            {
              "number": "1.1.7",
              "title": "Environment",
              "points": [
                { "label": "a", "content": "pollution" },
                { "label": "b", "content": "waste disposal" },
                { "label": "c", "content": "materials separation" },
                { "label": "d", "content": "transportation of goods around the world" },
                { "label": "e", "content": "packaging of goods" }
              ]
            },
            {
              "number": "1.1.8",
              "title": "Production techniques and systems",
              "points": [
                { "label": "a", "content": "standardised design and components" },
                { "label": "b", "content": "just-in-time (JIT)" },
                { "label": "c", "content": "lean manufacturing" },
                { "label": "d", "content": "batch" },
                { "label": "e", "content": "continuous" },
                { "label": "f", "content": "one off" },
                { "label": "g", "content": "mass" }
              ]
            }
          ]
        },
        {
          "number": "1.2",
          "title": "How the critical evaluation of new and emerging technologies informs design decisions; considering contemporary and potential future scenarios from different perspectives, such as ethics and the environment",
          "description": "To recognise the importance of the evaluative process and respective criteria when considering the impact of new and emerging technologies to a range of scenarios.",
          "sub_items": [
            {
              "number": "1.2.1",
              "title": "How to critically evaluate new and emerging technologies that inform design decisions",
              "points": [
                { "label": "a", "content": "budget constraints" },
                { "label": "b", "content": "timescale" },
                { "label": "c", "content": "who the product is for" },
                { "label": "d", "content": "the materials used" },
                { "label": "e", "content": "manufacturing capabilities" }
              ]
            },
            {
              "number": "1.2.2",
              "title": "How critical evaluations can be used to inform design decisions, including the consideration of contemporary and potential future scenarios",
              "points": [
                { "label": "a", "content": "natural disasters" },
                { "label": "b", "content": "medical advances" },
                { "label": "c", "content": "travel" },
                { "label": "d", "content": "global warming" },
                { "label": "e", "content": "communication" }
              ]
            },
            {
              "number": "1.2.3",
              "title": "Ethical perspectives when evaluating new and emerging technologies",
              "points": [
                { "label": "a", "content": "where it was made" },
                { "label": "b", "content": "who was it made by" },
                { "label": "c", "content": "who will it benefit" },
                { "label": "d", "content": "fair trade products" }
              ]
            },
            {
              "number": "1.2.4",
              "title": "Environmental perspectives when evaluating new and emerging technologies",
              "points": [
                { "label": "a", "content": "use of materials" },
                { "label": "b", "content": "carbon footprint" },
                { "label": "c", "content": "energy usage and consumption during manufacture and transportation" },
                { "label": "d", "content": "life cycle analysis (LCA)" }
              ]
            }
          ]
        },
        {
          "number": "1.3",
          "title": "How energy is generated and stored in order to choose and use appropriate sources to make products and power systems",
          "description": "The processes, applications, characteristics, advantages and disadvantages of the following, in order to be able to discriminate between them and to select appropriately.",
          "sub_items": [
            {
              "number": "1.3.1",
              "title": "Sources, generation and storage of energy",
              "points": [
                { "label": "a", "content": "fossil fuels - oil, gas, coal" },
                { "label": "b", "content": "biodiesel and biomass" },
                { "label": "c", "content": "biofuels" },
                { "label": "d", "content": "tidal" },
                { "label": "e", "content": "wind" },
                { "label": "f", "content": "solar" },
                { "label": "g", "content": "hydroelectric" }
              ]
            },
            {
              "number": "1.3.2",
              "title": "Powering systems",
              "points": [
                { "label": "a", "content": "batteries and cells" },
                { "label": "b", "content": "solar cells" },
                { "label": "c", "content": "mains electricity" },
                { "label": "d", "content": "wind power" }
              ]
            },
            {
              "number": "1.3.3",
              "title": "Factors to consider when choosing appropriate energy sources to make products and power systems",
              "points": [
                { "label": "a", "content": "portability of the power source" },
                { "label": "b", "content": "environmental impact" },
                { "label": "c", "content": "power output" },
                { "label": "d", "content": "circuit/system connections" },
                { "label": "e", "content": "cost" }
              ]
            }
          ]
        },
        {
          "number": "1.4",
          "title": "Developments in modern and smart materials, composite materials and technical textiles",
          "description": "To apply technical knowledge and understanding of the characteristics, applications, advantages and disadvantages of the following.",
          "sub_items": [
            {
              "number": "1.4.1",
              "title": "Modern and smart materials",
              "points": [
                { "label": "a", "content": "shape-memory alloys (SMAs)" },
                { "label": "b", "content": "nanomaterials" },
                { "label": "c", "content": "reactive glass" },
                { "label": "d", "content": "piezoelectric materials" },
                { "label": "e", "content": "temperature-responsive polymers" },
                { "label": "f", "content": "conductive inks" }
              ]
            },
            {
              "number": "1.4.2",
              "title": "Composites",
              "points": [
                { "label": "a", "content": "concrete" },
                { "label": "b", "content": "plywood" },
                { "label": "c", "content": "fibre/carbon/glass" },
                { "label": "d", "content": "reinforced polymers" },
                { "label": "e", "content": "robotic materials" }
              ]
            },
            {
              "number": "1.4.3",
              "title": "Technical textiles",
              "points": [
                { "label": "a", "content": "agro-textiles" },
                { "label": "b", "content": "construction textiles" },
                { "label": "c", "content": "geo-textiles" },
                { "label": "d", "content": "domestic textiles" },
                { "label": "e", "content": "environmentally friendly textiles" },
                { "label": "f", "content": "protective textiles" },
                { "label": "g", "content": "sports textiles" }
              ]
            }
          ]
        },
        {
          "number": "1.5",
          "title": "The functions of mechanical devices used to produce different sorts of movements, including the changing of magnitude and the direction of forces",
          "description": "The performance, principles, applications and the influence on the design of products of the following.",
          "sub_items": [
            {
              "number": "1.5.1",
              "title": "Types of movement",
              "points": [
                { "label": "a", "content": "linear" },
                { "label": "b", "content": "reciprocation" },
                { "label": "c", "content": "rotary" },
                { "label": "d", "content": "oscillation" }
              ]
            },
            {
              "number": "1.5.2",
              "title": "Classification of levers",
              "points": [
                { "label": "a", "content": "class 1, 2 and 3" },
                { "label": "b", "content": "calculations related to mechanical advantage (MA), velocity ratio (VR), load, effort and efficiency" }
              ]
            },
            {
              "number": "1.5.3",
              "title": "Linkages",
              "points": [
                { "label": "a", "content": "bell crank" },
                { "label": "b", "content": "reverse motion linkages" }
              ]
            },
            {
              "number": "1.5.4",
              "title": "Cams",
              "points": [
                { "label": "a", "content": "pear shaped" },
                { "label": "b", "content": "eccentric (circular)" },
                { "label": "c", "content": "drop (snail)" }
              ]
            },
            {
              "number": "1.5.5",
              "title": "Followers",
              "points": [
                { "label": "a", "content": "roller" },
                { "label": "b", "content": "knife" },
                { "label": "c", "content": "flat followers" }
              ]
            },
            {
              "number": "1.5.6",
              "title": "Pulleys and belts",
              "points": [
                { "label": "a", "content": "V-belt" },
                { "label": "b", "content": "velocity ratio (VR)" },
                { "label": "c", "content": "input and output speeds" }
              ]
            },
            {
              "number": "1.5.7",
              "title": "Cranks and sliders",
              "points": []
            },
            {
              "number": "1.5.8",
              "title": "Gear types",
              "points": [
                { "label": "a", "content": "simple and compound gear train" },
                { "label": "b", "content": "idler gear" },
                { "label": "c", "content": "revolutions per minute (RPM) calculations" },
                { "label": "d", "content": "bevel gears" },
                { "label": "e", "content": "rack and pinion" }
              ]
            }
          ]
        },
        {
          "number": "1.6",
          "title": "How electronic systems provide functionality to products and processes, including sensors and control devices to respond to a variety of inputs, and devices to produce a range of outputs",
          "description": "Recognise and apply knowledge and understanding of the working characteristics, applications, advantages and disadvantages of the following.",
          "sub_items": [
            {
              "number": "1.6.1",
              "title": "Sensors",
              "points": [
                { "label": "a", "content": "the role of sensors in electronic systems" },
                { "label": "b", "content": "light-dependent resistors (LDRs)" },
                { "label": "c", "content": "thermistor" }
              ]
            },
            {
              "number": "1.6.2",
              "title": "Control devices and components",
              "points": [
                { "label": "a", "content": "the role of switches in electronic systems" },
                { "label": "b", "content": "transistors" },
                { "label": "c", "content": "resistors" }
              ]
            },
            {
              "number": "1.6.3",
              "title": "Outputs",
              "points": [
                { "label": "a", "content": "the role of outputs in electronic systems" },
                { "label": "b", "content": "buzzers" },
                { "label": "c", "content": "light-emitting diodes (LEDs)" }
              ]
            }
          ]
        },
        {
          "number": "1.7",
          "title": "The use of programmable components to embed functionality into products in order to enhance and customise their operation",
          "description": "The performance and functionality of using programmable components.",
          "sub_items": [
            {
              "number": "1.7.1",
              "title": "How to make use of flowcharts",
              "points": []
            },
            {
              "number": "1.7.2",
              "title": "How to switch outputs on/off in relation to inputs and decisions",
              "points": []
            },
            {
              "number": "1.7.3",
              "title": "How to process and respond to analogue inputs",
              "points": []
            },
            {
              "number": "1.7.4",
              "title": "How to use simple routines to control outputs with delays, loops and counts",
              "points": []
            }
          ]
        },
        {
          "number": "1.8",
          "title": "The categorisation of the types, properties and structure of ferrous and non-ferrous metals",
          "description": "To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.",
          "sub_items": [
            {
              "number": "1.8.1",
              "title": "Ferrous metals",
              "points": [
                { "label": "a", "content": "mild steel" },
                { "label": "b", "content": "stainless steel" },
                { "label": "c", "content": "cast iron" }
              ]
            },
            {
              "number": "1.8.2",
              "title": "Non-ferrous metals",
              "points": [
                { "label": "a", "content": "aluminium" },
                { "label": "b", "content": "copper" },
                { "label": "c", "content": "brass" }
              ]
            },
            {
              "number": "1.8.3",
              "title": "Properties",
              "points": [
                { "label": "a", "content": "ductility" },
                { "label": "b", "content": "malleability" },
                { "label": "c", "content": "hardness" }
              ]
            }
          ]
        },
        {
          "number": "1.9",
          "title": "The categorisation of the types, properties and structure of papers and boards",
          "description": "To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.",
          "sub_items": [
            {
              "number": "1.9.1",
              "title": "Paper",
              "points": [
                { "label": "a", "content": "copier paper" },
                { "label": "b", "content": "cartridge paper" },
                { "label": "c", "content": "tracing paper" }
              ]
            },
            {
              "number": "1.9.2",
              "title": "Board",
              "points": [
                { "label": "a", "content": "folding boxboard" },
                { "label": "b", "content": "corrugated board" },
                { "label": "c", "content": "solid white board" }
              ]
            },
            {
              "number": "1.9.3",
              "title": "Properties",
              "points": [
                { "label": "a", "content": "flexibility" },
                { "label": "b", "content": "printability" },
                { "label": "c", "content": "biodegradability" }
              ]
            }
          ]
        },
        {
          "number": "1.10",
          "title": "The categorisation of the types, properties and structure of thermoforming and thermosetting polymers",
          "description": "To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.",
          "sub_items": [
            {
              "number": "1.10.1",
              "title": "Thermoforming polymers",
              "points": [
                { "label": "a", "content": "acrylic" },
                { "label": "b", "content": "high impact polystyrene (HIPS)" },
                { "label": "c", "content": "biodegradable polymers - Biopol®" }
              ]
            },
            {
              "number": "1.10.2",
              "title": "Thermosetting polymers",
              "points": [
                { "label": "a", "content": "polyester resin" },
                { "label": "b", "content": "urea formaldehyde" }
              ]
            },
            {
              "number": "1.10.3",
              "title": "Properties",
              "points": [
                { "label": "a", "content": "insulator of heat" },
                { "label": "b", "content": "insulator of electricity" },
                { "label": "c", "content": "toughness" }
              ]
            }
          ]
        },
        {
          "number": "1.11",
          "title": "The categorisation of the types, properties and structure of natural, synthetic, blended and mixed fibres, and woven, non-woven and knitted textiles",
          "description": "To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.",
          "sub_items": [
            {
              "number": "1.11.1",
              "title": "Natural",
              "points": [
                { "label": "a", "content": "animal - wool" },
                { "label": "b", "content": "vegetable - cotton" }
              ]
            },
            {
              "number": "1.11.2",
              "title": "Synthetic",
              "points": [
                { "label": "a", "content": "polyester" },
                { "label": "b", "content": "acrylic" }
              ]
            },
            {
              "number": "1.11.3",
              "title": "Woven",
              "points": [
                { "label": "a", "content": "plain - calico" },
                { "label": "b", "content": "twill - denim" }
              ]
            },
            {
              "number": "1.11.4",
              "title": "Non-woven",
              "points": [
                { "label": "a", "content": "felted wool fabric" },
                { "label": "b", "content": "bonded fibres/webs" }
              ]
            },
            {
              "number": "1.11.5",
              "title": "Knitted",
              "points": [
                { "label": "a", "content": "weft-knitted fabrics" },
                { "label": "b", "content": "warp-knitted fabrics" }
              ]
            },
            {
              "number": "1.11.6",
              "title": "Properties",
              "points": [
                { "label": "a", "content": "elasticity" },
                { "label": "b", "content": "resilience" },
                { "label": "c", "content": "durability" }
              ]
            }
          ]
        },
        {
          "number": "1.12",
          "title": "The categorisation of the types, properties and structure of natural and manufactured timbers",
          "description": "To apply knowledge and understanding of working properties, characteristics, applications, advantages and disadvantages of the following types of materials, in order to be able to discriminate between them and select appropriately.",
          "sub_items": [
            {
              "number": "1.12.1",
              "title": "Natural timbers - hardwoods",
              "points": [
                { "label": "a", "content": "oak" },
                { "label": "b", "content": "mahogany" },
                { "label": "c", "content": "beech" },
                { "label": "d", "content": "balsa" }
              ]
            },
            {
              "number": "1.12.2",
              "title": "Natural timbers - softwoods",
              "points": [
                { "label": "a", "content": "pine" },
                { "label": "b", "content": "cedar" }
              ]
            },
            {
              "number": "1.12.3",
              "title": "Manufactured timbers",
              "points": [
                { "label": "a", "content": "plywood" },
                { "label": "b", "content": "medium density fibreboard (MDF)" }
              ]
            },
            {
              "number": "1.12.4",
              "title": "Properties",
              "points": [
                { "label": "a", "content": "hardness" },
                { "label": "b", "content": "toughness" },
                { "label": "c", "content": "durability" }
              ]
            }
          ]
        },
        {
          "number": "1.13",
          "title": "All design and technological practice takes place within contexts which inform outcomes",
          "description": "Performance characteristics of a wide range of materials, components and manufacturing processes, in order to be able to discriminate between them and select appropriately.",
          "sub_items": [
            {
              "number": "1.13.1",
              "title": "A wide range of materials, components and manufacturing processes for a range of contexts, to inform outcomes",
              "points": [
                { "label": "a", "content": "the properties of materials and or components" },
                { "label": "b", "content": "the advantages and disadvantages of materials and components and manufacturing processes" },
                { "label": "c", "content": "justification of the choice of materials and components and manufacturing processes" }
              ]
            }
          ]
        },
        {
          "number": "1.14",
          "title": "Investigate environmental, social and economic challenges when identifying opportunities and constraints that influence the processes of designing and making",
          "description": "Implications for designers and manufacturers of the following when developing designs and manufacturing products.",
          "sub_items": [
            {
              "number": "1.14.1",
              "title": "Respect for different social, ethnic and economic groups who have different needs and values when identifying new design opportunities",
              "points": []
            },
            {
              "number": "1.14.2",
              "title": "An appreciation of the environmental, social and economic issues relating to the design and manufacture of products, including, fair trade, carbon offsetting, product disassembly and disposal",
              "points": []
            },
            {
              "number": "1.14.3",
              "title": "The main factors relating to 'Green Designs'",
              "points": []
            },
            {
              "number": "1.14.4",
              "title": "The main factors relating to recycling and reusing materials or products",
              "points": []
            },
            {
              "number": "1.14.5",
              "title": "Human capability",
              "points": []
            },
            {
              "number": "1.14.6",
              "title": "Cost of materials",
              "points": []
            },
            {
              "number": "1.14.7",
              "title": "Manufacturing capability",
              "points": []
            },
            {
              "number": "1.14.8",
              "title": "Environmental impact - life cycle analysis (LCA)",
              "points": []
            }
          ]
        },
        {
          "number": "1.15",
          "title": "Investigate and analyse the work of past and present professionals and companies in order to inform design",
          "description": "Strategies, techniques and approaches employed when investigating and analysing the work of others.",
          "sub_items": [
            {
              "number": "1.15.1",
              "title": "Analysing a product to the following specification criteria",
              "points": [
                { "label": "a", "content": "form" },
                { "label": "b", "content": "function" },
                { "label": "c", "content": "client and user requirements" },
                { "label": "d", "content": "performance requirements" },
                { "label": "e", "content": "materials and components/systems" },
                { "label": "f", "content": "scale of production and cost" },
                { "label": "g", "content": "sustainability" },
                { "label": "h", "content": "aesthetics" },
                { "label": "i", "content": "marketability" },
                { "label": "j", "content": "consideration of innovation" }
              ]
            },
            {
              "number": "1.15.2",
              "title": "The work of past and present designers and companies",
              "points": [
                { "label": "", "content": "Centres should choose a selection of designers for study. Suggestions for designers and companies for study can be found on the Pearson Edexcel website." }
              ]
            }
          ]
        },
        {
          "number": "1.16",
          "title": "Use different design strategies to generate initial ideas and avoid design fixation",
          "description": "Strategies, techniques and approaches employed when generating design ideas.",
          "sub_items": [
            {
              "number": "1.16.1",
              "title": "Use of different design strategies",
              "points": [
                { "label": "a", "content": "collaboration" },
                { "label": "b", "content": "user-centred design" },
                { "label": "c", "content": "systems thinking" }
              ]
            }
          ]
        },
        {
          "number": "1.17",
          "title": "Develop, communicate, record and justify design ideas, applying suitable techniques",
          "description": "Techniques employed when communicating and recording design ideas.",
          "sub_items": [
            {
              "number": "1.17.1",
              "title": "Develop and use a range of communication techniques and media to present the design ideas",
              "points": [
                { "label": "a", "content": "freehand sketching (2D and/or 3D)" },
                { "label": "b", "content": "annotated sketches" },
                { "label": "c", "content": "cut and paste techniques" },
                { "label": "d", "content": "digital photography/media" },
                { "label": "e", "content": "3D models" },
                { "label": "f", "content": "isometric and oblique projection" },
                { "label": "g", "content": "perspective drawing" },
                { "label": "h", "content": "orthographic and exploded views" },
                { "label": "i", "content": "assembly drawings" },
                { "label": "j", "content": "system and schematic diagrams" },
                { "label": "k", "content": "computer-aided design (CAD) and other specialist computer drawing programs" }
              ]
            },
            {
              "number": "1.17.2",
              "title": "Record and justify design ideas clearly and effectively using written techniques",
              "points": []
            }
          ]
        }
      ]
    },
    {
      "number": "5",
      "title": "Systems",
      "key_ideas": [
        {
          "number": "5.1",
          "title": "Design contexts",
          "sub_items": [
            {
              "number": "5.1.1",
              "title": "When designing or modifying a product, students should be able to apply their knowledge and understanding of materials, components and manufacturing processes.",
              "points": []
            }
          ]
        },
        {
          "number": "5.2",
          "title": "The sources, origins, physical and working properties of components and systems and their social and ecological footprint",
          "description": "To apply knowledge and understanding of the advantages, disadvantages and applications of the following components, in order to be able to discriminate between them and select appropriately.",
          "sub_items": [
            {
              "number": "5.2.1",
              "title": "Sensors",
              "points": [
                { "label": "a", "content": "light-dependent resistors (LDRs) (in topic 1)" },
                { "label": "b", "content": "thermistor (in topic 1)" },
                { "label": "c", "content": "moisture sensor" },
                { "label": "d", "content": "piezoelectric sensor" }
              ]
            },
            {
              "number": "5.2.2",
              "title": "Control devices and components",
              "points": [
                { "label": "a", "content": "rocker switch (on/off) (in topic 1)" },
                { "label": "b", "content": "resistors (in topic 1)" },
                { "label": "c", "content": "push to make switch (PTM)" },
                { "label": "d", "content": "micro switch" },
                { "label": "e", "content": "reed switch" },
                { "label": "f", "content": "variable resistors" },
                { "label": "g", "content": "transistor (bipolar)" },
                { "label": "h", "content": "microprocessor" },
                { "label": "i", "content": "microcontroller/PIC" },
                { "label": "j", "content": "relay" }
              ]
            },
            {
              "number": "5.2.3",
              "title": "Outputs",
              "points": [
                { "label": "a", "content": "buzzers (in topic 1)" },
                { "label": "b", "content": "light-emitting diodes (LEDs) (in topic 1)" },
                { "label": "c", "content": "loudspeakers" },
                { "label": "d", "content": "motors" }
              ]
            },
            {
              "number": "5.2.4",
              "title": "Sources and origins - where components and systems are resourced/manufactured and their geographical origin",
              "points": [
                { "label": "a", "content": "Russia, Saudi Arabia, United States: polymers from crude oil - acrylic, high impact polystyrene (HIPS), acrylonitrile butadiene styrene (ABS)" },
                { "label": "b", "content": "China, Russia, USA - silicon" },
                { "label": "c", "content": "China, Australia, Russia - gold" },
                { "label": "d", "content": "Chile, China, Peru - copper" },
                { "label": "e", "content": "Australia, Chile, Argentina - lithium" },
                { "label": "f", "content": "China, Russia, Canada - aluminium" },
                { "label": "g", "content": "China, Australia, USA - Rare Earth Elements (REEs)" },
                { "label": "h", "content": "Philippines, Indonesia, Russia, Canada and Australia - nickel" }
              ]
            },
            {
              "number": "5.2.5",
              "title": "The physical characteristics of each component and system",
              "points": [
                { "label": "a", "content": "tolerances, ratings and values - resistor colour codes" },
                { "label": "b", "content": "material selection for case construction - physical/working properties, sustainability, manufacturing processes" }
              ]
            },
            {
              "number": "5.2.6",
              "title": "Working properties - the way in which each material behaves or responds to external sources",
              "points": [
                { "label": "a", "content": "conductors, insulators - thermal, electrical" },
                { "label": "b", "content": "polymers used for cases - durability, hardness, toughness, elasticity" }
              ]
            },
            {
              "number": "5.2.7",
              "title": "Social footprint",
              "points": [
                { "label": "a", "content": "relying on scarce and/or hazardous elements used in components and systems - cobalt, tantalum, lithium" },
                { "label": "b", "content": "effects of using components and systems, including modern communications - mobile phones, computers, games consoles, social media networks" }
              ]
            },
            {
              "number": "5.2.8",
              "title": "Ecological footprint",
              "points": [
                { "label": "a", "content": "effects of material extraction and processing of elements" },
                { "label": "b", "content": "effects of built-in obsolescence" },
                { "label": "c", "content": "effects of use" },
                { "label": "d", "content": "the effects of disposal of components and systems - toxicity of metals and polymers" }
              ]
            }
          ]
        },
        {
          "number": "5.3",
          "title": "The way in which the selection of components and systems is influenced",
          "description": "The influence of the following factors when selecting materials/components for a specific application.",
          "sub_items": [
            {
              "number": "5.3.1",
              "title": "Aesthetic factors - the selection of materials and finishes for enclosures and cases",
              "points": [
                { "label": "a", "content": "form" },
                { "label": "b", "content": "colour" },
                { "label": "c", "content": "texture" }
              ]
            },
            {
              "number": "5.3.2",
              "title": "Environmental factors",
              "points": [
                { "label": "a", "content": "the principles of the Restriction of Hazardous Substances (RoHS) Directive for selection" },
                { "label": "b", "content": "the principles of the Waste Electrical and Electronic Equipment (WEEE) Directive for disposal" }
              ]
            },
            {
              "number": "5.3.3",
              "title": "Availability factors",
              "points": [
                { "label": "a", "content": "use of stock materials" },
                { "label": "b", "content": "use of specialist materials" },
                { "label": "c", "content": "use of scarce elements" }
              ]
            },
            {
              "number": "5.3.4",
              "title": "Cost factors",
              "points": [
                { "label": "a", "content": "quality of component - tolerances" },
                { "label": "b", "content": "manufacturing processes necessary" }
              ]
            },
            {
              "number": "5.3.5",
              "title": "Social factors",
              "points": [
                { "label": "a", "content": "use for different social groups" },
                { "label": "b", "content": "trends/fashion" },
                { "label": "c", "content": "popularity" }
              ]
            },
            {
              "number": "5.3.6",
              "title": "Cultural and ethical factors",
              "points": [
                { "label": "a", "content": "avoiding offence" },
                { "label": "b", "content": "suitability for intended market" },
                { "label": "c", "content": "use of colour and language" },
                { "label": "d", "content": "the consumer society" },
                { "label": "e", "content": "the effects of mass production" },
                { "label": "f", "content": "built-in product obsolescence" }
              ]
            }
          ]
        },
        {
          "number": "5.4",
          "title": "The impact of forces and stresses on objects and how they can be reinforced and stiffened",
          "description": "An awareness of the influence of forces and stresses that act on materials and the methods that can be employed to resist them.",
          "sub_items": [
            {
              "number": "5.4.1",
              "title": "Forces and stresses",
              "points": [
                { "label": "a", "content": "tension" },
                { "label": "b", "content": "compression" },
                { "label": "c", "content": "torsion" },
                { "label": "d", "content": "shear" }
              ]
            },
            {
              "number": "5.4.2",
              "title": "Reinforcement/stiffening techniques",
              "points": [
                { "label": "a", "content": "using composite materials" },
                { "label": "b", "content": "ribbing to strengthen case structures" }
              ]
            }
          ]
        },
        {
          "number": "5.5",
          "title": "Stock forms, types and sizes in order to calculate and determine the quantity of components required",
          "description": "To apply knowledge and understanding of the advantages, disadvantages and applications of the following stock forms/sizes, in order to be able to discriminate between them and select and apply appropriately.",
          "sub_items": [
            {
              "number": "5.5.1",
              "title": "Stock forms/types",
              "points": [
                { "label": "a", "content": "tolerances, ratings and values such as E12 series resistors" },
                { "label": "b", "content": "surface-mount technology (SMT)" },
                { "label": "c", "content": "through-hole components" }
              ]
            },
            {
              "number": "5.5.2",
              "title": "Sizes",
              "points": [
                { "label": "a", "content": "unit of current (amp)" },
                { "label": "b", "content": "unit of resistance (ohm)" },
                { "label": "c", "content": "unit of potential difference (volt)" },
                { "label": "d", "content": "applications of Ohm's Law: V = I x R" },
                { "label": "e", "content": "resistors in series: R_total = R1 + R2 + R3 etc." },
                { "label": "f", "content": "resistors in parallel: 1/R_total = 1/R1 + 1/R2 + 1/R3 etc." },
                { "label": "g", "content": "area" },
                { "label": "h", "content": "diameter" }
              ]
            }
          ]
        },
        {
          "number": "5.6",
          "title": "Alternative processes that can be used to manufacture components and systems to different scales of production",
          "description": "Application, advantages and disadvantages, of the following processes, scales of production and techniques when manufacturing products, in order to be able to discriminate between them and select appropriately for use.",
          "sub_items": [
            {
              "number": "5.6.1",
              "title": "Processes",
              "points": [
                { "label": "a", "content": "photo etching" },
                { "label": "b", "content": "PCB population" },
                { "label": "c", "content": "PCB drilling and soldering" }
              ]
            },
            {
              "number": "5.6.2",
              "title": "Scales of production",
              "points": [
                { "label": "a", "content": "one-off prototyping (breadboard)" },
                { "label": "b", "content": "batch" },
                { "label": "c", "content": "mass production" },
                { "label": "d", "content": "continuous" }
              ]
            },
            {
              "number": "5.6.3",
              "title": "Techniques for quantity production",
              "points": [
                { "label": "a", "content": "pick and place technology" },
                { "label": "b", "content": "surface-mount technology (SMT)" },
                { "label": "c", "content": "quality control" },
                { "label": "d", "content": "marking-out methods (use of reference points, lines and surfaces)" },
                { "label": "e", "content": "templates" },
                { "label": "f", "content": "patterns" },
                { "label": "g", "content": "sub-assembly" },
                { "label": "h", "content": "working within tolerance" },
                { "label": "i", "content": "efficient cutting to minimise waste" }
              ]
            }
          ]
        },
        {
          "number": "5.7",
          "title": "Specialist techniques, tools, equipment and processes that can be used to shape, fabricate, construct and assemble a high-quality systems prototype",
          "description": "Application, advantages and disadvantages, of the following specialist techniques when manufacturing products, in order to be able to discriminate between them and select appropriately for use.",
          "sub_items": [
            {
              "number": "5.7.1",
              "title": "Tools and equipment",
              "points": [
                { "label": "a", "content": "hand tools" },
                { "label": "b", "content": "machinery" },
                { "label": "c", "content": "digital design and manufacture" }
              ]
            },
            {
              "number": "5.7.2",
              "title": "Shaping",
              "points": [
                { "label": "a", "content": "vacuum forming" },
                { "label": "b", "content": "CNC laser cutting" },
                { "label": "c", "content": "3D printing" },
                { "label": "d", "content": "drilling" }
              ]
            },
            {
              "number": "5.7.3",
              "title": "Fabricating/constructing/assembling",
              "points": [
                { "label": "a", "content": "PCB mounting methods - through hole, surface mount" },
                { "label": "b", "content": "cable management - sleeving, ties" },
                { "label": "c", "content": "wastage" },
                { "label": "d", "content": "addition" }
              ]
            }
          ]
        },
        {
          "number": "5.8",
          "title": "Appropriate surface treatments and finishes that can be applied to components and systems for functional and aesthetic purposes",
          "description": "Application, advantages and disadvantages of the following finishing techniques and methods of preservation, in order to be able to discriminate between them and select appropriately for use.",
          "sub_items": [
            {
              "number": "5.8.1",
              "title": "Surface finishes and treatments",
              "points": [
                { "label": "a", "content": "metal plating to enhance the functionality and performance of electronic connections" },
                { "label": "b", "content": "insulating coatings and coverings for functionality/safety" },
                { "label": "c", "content": "resistor colour code bands to identify values and tolerance" },
                { "label": "d", "content": "finishes applied to cases - anodising, painting, screen printing" }
              ]
            }
          ]
        }
      ]
    }
  ]
};

function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return "'" + str.replace(/'/g, "''") + "'";
}

let sql = "DO $$\n";
sql += "DECLARE\n";
sql += "  v_spec_id TEXT;\n";
sql += "  v_unit_id TEXT;\n";
sql += "  v_key_idea_id TEXT;\n";
sql += "  v_sub_item_id TEXT;\n";
sql += "BEGIN\n\n";

// Specification
const spec = data.specification;
sql += `  -- Ensure Subject Exists: ${spec.subject}\n`;
sql += `  INSERT INTO subjects (subject) VALUES (${escapeSql(spec.subject)}) ON CONFLICT (subject) DO NOTHING;\n\n`;

sql += `  -- Specification: ${spec.title}\n`;
sql += `  SELECT specification_id INTO v_spec_id FROM specifications WHERE title = ${escapeSql(spec.title)} AND subject = ${escapeSql(spec.subject)};\n`;
sql += `  IF v_spec_id IS NULL THEN\n`;
sql += `    INSERT INTO specifications (title, subject, exam_board, level) VALUES (${escapeSql(spec.title)}, ${escapeSql(spec.subject)}, ${escapeSql(spec.exam_board)}, ${escapeSql(spec.level)}) RETURNING specification_id INTO v_spec_id;\n`;
sql += `  ELSE\n`;
sql += `    UPDATE specifications SET exam_board = ${escapeSql(spec.exam_board)}, level = ${escapeSql(spec.level)} WHERE specification_id = v_spec_id;\n`;
sql += `  END IF;\n\n`;

// Units
data.units.forEach((unit, unitIdx) => {
  sql += `  -- Unit: ${unit.number} - ${unit.title}\n`;
  sql += `  SELECT unit_id INTO v_unit_id FROM specification_units WHERE specification_id = v_spec_id AND number = ${escapeSql(unit.number)};\n`;
  sql += `  IF v_unit_id IS NULL THEN\n`;
  sql += `    INSERT INTO specification_units (specification_id, number, title, order_index) VALUES (v_spec_id, ${escapeSql(unit.number)}, ${escapeSql(unit.title)}, ${unitIdx}) RETURNING unit_id INTO v_unit_id;\n`;
  sql += `  ELSE\n`;
  sql += `    UPDATE specification_units SET title = ${escapeSql(unit.title)}, order_index = ${unitIdx} WHERE unit_id = v_unit_id;\n`;
  sql += `  END IF;\n\n`;

  // Key Ideas
  unit.key_ideas.forEach((keyIdea, kiIdx) => {
    sql += `    -- Key Idea: ${keyIdea.number}\n`;
    sql += `    SELECT key_idea_id INTO v_key_idea_id FROM key_ideas WHERE unit_id = v_unit_id AND number = ${escapeSql(keyIdea.number)};\n`;
    sql += `    IF v_key_idea_id IS NULL THEN\n`;
    sql += `      INSERT INTO key_ideas (unit_id, number, title, description, order_index) VALUES (v_unit_id, ${escapeSql(keyIdea.number)}, ${escapeSql(keyIdea.title)}, ${escapeSql(keyIdea.description)}, ${kiIdx}) RETURNING key_idea_id INTO v_key_idea_id;\n`;
    sql += `    ELSE\n`;
    sql += `      UPDATE key_ideas SET title = ${escapeSql(keyIdea.title)}, description = ${escapeSql(keyIdea.description)}, order_index = ${kiIdx} WHERE key_idea_id = v_key_idea_id;\n`;
    sql += `    END IF;\n\n`;

    // Sub Items
    keyIdea.sub_items.forEach((subItem, siIdx) => {
      sql += `      -- Sub Item: ${subItem.number}\n`;
      sql += `      SELECT sub_item_id INTO v_sub_item_id FROM sub_items WHERE key_idea_id = v_key_idea_id AND number = ${escapeSql(subItem.number)};\n`;
      sql += `      IF v_sub_item_id IS NULL THEN\n`;
      sql += `        INSERT INTO sub_items (key_idea_id, number, title, order_index) VALUES (v_key_idea_id, ${escapeSql(subItem.number)}, ${escapeSql(subItem.title)}, ${siIdx}) RETURNING sub_item_id INTO v_sub_item_id;\n`;
      sql += `      ELSE\n`;
      sql += `        UPDATE sub_items SET title = ${escapeSql(subItem.title)}, order_index = ${siIdx} WHERE sub_item_id = v_sub_item_id;\n`;
      sql += `      END IF;\n\n`;

      // Points
      // For points, we don't have a stable "number" or "label" that is definitely unique (some might have same label or empty label).
      // We'll delete existing points for this sub-item and re-insert to ensure clean state and order.
      // Or we can try to key off 'label' + 'content'.
      // Given the request for no duplication and idempotency, wiping points for the sub-item is safest if the sub-item exists.
      // But "upsert" usually implies updating if exists.
      // Let's assume (label, content) uniqueness or just delete/reinsert for points as they are dependent leaf nodes.
      // Strategy: Delete all points for this sub_item and insert fresh.
      
      sql += `      DELETE FROM sub_item_points WHERE sub_item_id = v_sub_item_id;\n`;
      
      subItem.points.forEach((point, pIdx) => {
        sql += `      INSERT INTO sub_item_points (sub_item_id, label, content, order_index) VALUES (v_sub_item_id, ${escapeSql(point.label)}, ${escapeSql(point.content)}, ${pIdx});\n`;
      });
      sql += `\n`;
    });
  });
});

sql += "END $$;\n";

console.log(sql);
