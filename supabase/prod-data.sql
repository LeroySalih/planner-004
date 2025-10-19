SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict x4Mqw7c7YZU3nagajpWsZuLg2tvNyq1oJfDa2KIYG9dWNGAPc9J0iLCSGxn9loP

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: subjects; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."subjects" ("subject", "active") FROM stdin;
Mathematics	t
Science	t
History	t
English	t
Art	t
Design Technology	t
Computing	t
ICT	t
Computer Science	t
\.


--
-- Data for Name: units; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."units" ("unit_id", "title", "subject", "active", "description", "year") FROM stdin;
BEBRAS-7	0702 BEBRAS-7	Computing	t	Prepare and sit the BEBRAS competition	7
SCRATCH-BASICS	0703 Scratch Basics	Computing	t	\N	7
HTML	0802 HTML	Computing	t	\N	8
MICROBIT	0803 MICROBIT	Computing	t	\N	8
701-ISOMETRIC-SKETCHING	0701 Isometric Sketching	Design Technology	t	Pupils will learn to sketch designs in an Isometric perspective.	7
ONTRO-TO-PYTHON-TURTLE	0902 Intro to Python - Turtle	Computing	t	\N	8
0901-INDUCTION	0901 Induction	Computing	t	\N	9
KS3-QUICK-DESIGN	KS3 - Quick Design	Design Technology	t	This short project is designed to remind pupils of the design process	8
DOOR-HANGER	0703 Door Hanger	Design Technology	t	\N	7
UNIT003	World War II Overview (ME)	History	f	No description provided	7
TEST1	test1	Mathematics	f	\N	7
UNIT001	Algebra Basics (qwe)	Mathematics	f	No description provided	7
UNIT002	Introduction to Biology1	Science	f	No description provided	7
NEW-UNIT	new unit	Design Technology	f	\N	7
801-CANDLE-HOLDER	0801-Candle Holder	Design Technology	t	A unit that allows pupils to practice their design process skills while becoming familiar with producing 3D products.	7
INDUCTION	Induction - Computing	Computing	t	This unit of work will introduce pupisl to the basics of working in the lab, along with the software and processes that are used in Senior School.	7
CATS	CATS	Computing	t	During this unit, the pupisl will sit their CATS test.	7
DT-INDUCTION-KS4	DT Induction (KS4)	Design Technology	t	\N	10
10-2-ONSHAPE-BASIC-SKILLS	1002 Onshape Basic Skills	Design Technology	t	\N	10
DT-INDUCTION	0700 - DT Induction - KS3	Design Technology	t	This unitserves as a welcome to Design and Technology.  Pupils cover the basic rules of how to enter, exit and move around the class. Pupils also discuss the reason for DT and the design process.	7
UNIT004	0901-Automata - Steam Punk	Design Technology	t	Learn about Automata with a steampunk style	9
1001-CORE-1	1001-Core 1	Design Technology	t	\N	10
10-01-ICT-DIGITAL-DEVICES	10-01-ICT Digital Devices	ICT	t	\N	10
BEBRAS-8	BEBRAS-8	Computing	t	Prepare and sit the BEBRAS competition	8
BEBRAS-9	BEBRAS-9	Computing	t	Prepare and sit the BEBRAS competition	9
\.


--
-- Data for Name: lessons; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."lessons" ("lesson_id", "unit_id", "title", "active", "order_by") FROM stdin;
69da46b7-19db-47e0-93db-5b6fd95eef5e	701-ISOMETRIC-SKETCHING	Challenge: Draw a Toy Plane	t	6
4c13b48b-3af1-48cc-952e-428097c13686	701-ISOMETRIC-SKETCHING	5 – Details (Chamfers, Fillets, Holes and Ridges)	t	7
0a8d6d77-4479-4998-9a41-98e674ead134	701-ISOMETRIC-SKETCHING	Practice Lesson	t	1
b576b985-26c9-4f86-a465-b683d657f5d7	CATS	CATS Session 2	t	16
1250315e-5053-4f99-804c-40561ecbc346	UNIT001	l2	t	1
2b797faf-8639-4551-a3ad-bad3a8c2799c	UNIT001	L3	t	2
33c2b85f-3ce2-4f21-b21b-377cf20b2a21	CATS	CATS Session 1	t	15
d59fd538-dab0-4f25-9466-9c1d13b56964	UNIT001	L3	t	4
01962eaa-7a98-46b2-a273-ef716f12bd54	UNIT001	l5	t	5
ae878164-e454-40bb-b52a-6f799c00b039	UNIT001	l1	t	3
cedd9f2e-34c0-46ed-88a5-a3fdfd9fc7cf	INDUCTION	Induction 1	t	17
0c60fa60-a7ed-47f5-822e-94b3a02dc3a2	INDUCTION	Induction 2	t	18
5b4f0a5e-d001-443d-a141-1605d5f5d831	701-ISOMETRIC-SKETCHING	2 – Adding and Subtracting Shapes	t	2
7ca3caa4-c8b2-4ed4-82e3-51bc15439466	UNIT004	Des: Make Plan	t	5
9d3dd129-0a25-4f9e-a793-7a6edb45518e	UNIT004	Investigate Cams, Followers and Rockers	t	1
85bf23e8-0031-46dc-948e-cb5c6a9143d4	1001-CORE-1	Energy Generation Assessment	t	20
60dcabc1-89b4-4e0c-a3cc-db96a05caca5	1001-CORE-1	Energy Generation and Comparison	t	19
8ba04ee3-0983-470d-9524-a32584f4820e	1001-CORE-1	Production Scales	t	21
726e9467-3e08-4e30-b06c-ac603a576e3d	801-CANDLE-HOLDER	Evaluate	t	8
7b7d9425-e54b-4fa9-95ac-dc71b7ec46c3	1001-CORE-1	Emerging Technology	t	22
26d09acd-24fd-40d5-b631-457ae13dded3	1001-CORE-1	Emerging Technology Assessment	t	23
3a5487f9-7e76-4d97-b452-094b4409d560	10-2-ONSHAPE-BASIC-SKILLS	OnShape Planes	t	7
65871063-5469-4da7-bf88-dc3af13a522c	801-CANDLE-HOLDER	Writing a Design Specification	f	11
07bf233b-a07f-426b-948d-486cbb43b204	801-CANDLE-HOLDER	Des: Ideation - Initial Ideas	t	3
47cbfb42-2e8d-4ee7-ac0e-b732f95ab8c1	UNIT004	Des: Flat Prototype	t	3
db7a9daa-f08a-4776-b60e-21cb06a25333	10-2-ONSHAPE-BASIC-SKILLS	Onshape Introduction	t	0
513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	801-CANDLE-HOLDER	Inv: Structures in Design: Slots, Tabs & Stability	t	0
f525bbed-179b-4ec0-a60b-1d8e9ec8c575	NEW-UNIT	Test	t	7
abccd308-abc1-4433-ac35-207d0c2a3dbc	1001-CORE-1	Smart & Composite materials and technical textiles - Overview.	t	24
a6f08b0a-115e-4b3a-97e8-7a0a4533d017	DT-INDUCTION	DT Induction	f	10
a95b9992-5eab-4720-850c-164062a036a5	1001-CORE-1	Smart Materials	t	25
8115af17-90c5-4e35-aa58-722afd856ace	10-2-ONSHAPE-BASIC-SKILLS	OnShape Extrustions - Ex 1	t	3
879a4c7f-9a62-41d5-ac4f-5d8dbfc59d94	DT-INDUCTION-KS4	DT Induction to KS4	t	11
79315679-c71e-4998-a121-3464829aaff1	801-CANDLE-HOLDER	Inv: Investigating existing designs	t	1
9e810b7a-7a64-4adf-9d10-c60550273b49	KS3-QUICK-DESIGN	Make and Evaluate	t	31
a1cad678-35ea-4a5b-b799-12ac2eb7c51f	701-ISOMETRIC-SKETCHING	6-Assessment	t	5
dd003478-e764-48a6-b3c5-29449b365cec	KS3-QUICK-DESIGN	Investigate & Design	t	30
84ef0aee-3207-49fa-8049-49ce868d2b61	1001-CORE-1	Composite Matererials	t	26
42dbd5b1-162c-4c27-9547-79eb39b34b4d	1001-CORE-1	Technical Textiles	t	27
645bd8e1-2b8d-45a8-b7b3-30def0008dd1	1001-CORE-1	SCT - Assessment	t	28
bb677055-41fb-4522-839e-741bd4376f85	801-CANDLE-HOLDER	Inv: Write a simple Design Specification	t	2
76ed126c-cbca-45a3-aaba-ed2ac326c1bd	UNIT004	Des: Final Design	t	4
bdd6500e-cdfa-475e-9f33-496b5daf98b9	UNIT004	Make: Lightburn	t	7
96f9a9a3-20ad-4166-8368-33919a235436	UNIT004	Evaluate	t	8
467a1b3c-20a4-4960-8d2e-7b163c0821d4	10-2-ONSHAPE-BASIC-SKILLS	OnShape Variables	t	6
ba6232e8-d343-4583-9f6a-3cf3c8602de2	801-CANDLE-HOLDER	Des: Prototype Candle Handle	t	4
57f6e550-c3a0-40ab-a655-b04d9d957b43	801-CANDLE-HOLDER	Make: Using Lightburn	t	5
a4b64a59-c06d-46af-ba54-d225fe038340	801-CANDLE-HOLDER	Make: Assemble	t	6
0fb3433e-c64c-425f-b1e3-02d3eac7336c	801-CANDLE-HOLDER	Make: Finishing	t	7
0556b2f1-06f2-4270-b3bb-1e37779145a5	UNIT004	Inv: Posca Colour Grid	t	9
4c6ae118-4296-4830-a82a-aba00760e314	UNIT004	Des:Initial Designs	t	2
e6e4e70d-8fcf-4e7b-bbfe-8b37b5712886	10-2-ONSHAPE-BASIC-SKILLS	OnShape 3D tools	t	4
bde9f1d5-c81b-4639-9efe-18d05a3a132f	10-2-ONSHAPE-BASIC-SKILLS	OnShape Boolean Tools	t	5
fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	701-ISOMETRIC-SKETCHING	3 – Solids: Prisms and Pyramids	t	3
a2aa2eb2-c7e4-4359-9801-fb2c8680584d	701-ISOMETRIC-SKETCHING	4 – Circles, Curves and Ellipses	t	4
92a3d29d-8cb4-464f-8f67-83c7f8f4aba3	10-01-ICT-DIGITAL-DEVICES	Lesson 1 - Types of Digital Device	t	29
8d96130b-2336-46a1-a214-73ec4e7e980d	DT-INDUCTION	DT Induction Lesson	t	9
a433c9cb-aee5-4280-9b25-62a43ae4a53e	UNIT004	Investigate History	t	0
0b4d75e6-162d-4513-aca7-4ed842aa2f8d	UNIT004	Make:	t	6
20404875-be5c-42c9-9023-ed4539b45f1c	10-2-ONSHAPE-BASIC-SKILLS	Make a Box	t	8
ca8445e2-364b-410d-922f-57c1c2f9bf44	701-ISOMETRIC-SKETCHING	1 – Cubes and Cuboids	t	0
8265e3e2-cd36-49dd-ba4f-66e6a95cdef5	10-2-ONSHAPE-BASIC-SKILLS	OnShape 2D Basic Sketches	t	1
894d0db3-8267-419c-b809-7d602f4837ae	10-2-ONSHAPE-BASIC-SKILLS	OnShape Extrusions	t	2
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	10-2-ONSHAPE-BASIC-SKILLS	Assessment	t	9
\.


--
-- Data for Name: activities; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."activities" ("activity_id", "lesson_id", "title", "type", "body_data", "is_homework", "order_by", "active", "is_summative", "notes") FROM stdin;
bb550561-9a11-4d79-8736-b86374add18f	ca8445e2-364b-410d-922f-57c1c2f9bf44	Starter	show-video	{"fileUrl": "https://www.youtube.com/watch?v=oqgk6fdjnno"}	f	0	t	f	\N
4a4fe697-3bf4-46d9-abea-4b19008d94cd	ca8445e2-364b-410d-922f-57c1c2f9bf44	Test activity	file-download	\N	f	4	t	f	\N
6d8bb00b-c004-4118-a5a4-e45e5bb79e55	8d96130b-2336-46a1-a214-73ec4e7e980d	Homework: Formative	text	{"text": "Complete the assigned formative"}	t	0	t	f	\N
39a80822-5fd8-4e7c-aa4f-fa7b277329b1	bb677055-41fb-4522-839e-741bd4376f85	What is a Design Spec?	text	{"text": "Is a ACCESS FM shopping list, where every item is measurable."}	f	1	t	f	\N
4584d6ed-4e6e-4472-b89d-fc243392fcc6	bb677055-41fb-4522-839e-741bd4376f85	Whar are Must, Should, Could?	text	{"text": "Discuss the differences between Must, Should and Could."}	f	2	t	f	\N
3d5442bd-5bbb-4fc8-9021-a9b753216145	bb677055-41fb-4522-839e-741bd4376f85	Design Spec Exercise 1	text	{"text": "Write a design spec for your Pencil Case."}	f	3	t	f	\N
65ef1c0f-cf6c-45a6-bff4-8cf9df8f3342	a433c9cb-aee5-4280-9b25-62a43ae4a53e	Example Automate - School Class	show-video	{"fileUrl": "https://youtu.be/VUc2y4RpJtk?si=U4DiJsfYsMVgo0gu"}	f	0	t	f	\N
776d3a9d-df1e-4010-ac30-9e470e2b5d7d	a433c9cb-aee5-4280-9b25-62a43ae4a53e	Example Automata - Seagulls	show-video	{"fileUrl": "https://youtu.be/8NCCWeMjqhg?si=_DioAUeG9YBEAdvQ"}	f	1	t	f	\N
7c11e0f0-11e2-44c4-a311-7e2b5d70444b	a433c9cb-aee5-4280-9b25-62a43ae4a53e	Example Automata - School Class	show-video	{"fileUrl": "https://youtu.be/VUc2y4RpJtk?si=BHp6ZdKxgrBpPP4l"}	f	2	t	f	\N
f144af23-9ee1-41d7-ad8f-e5e364096c23	a433c9cb-aee5-4280-9b25-62a43ae4a53e	Example Automata - School Class	show-video	{"fileUrl": "https://www.youtube.com/watch?v=h5EWrFqXJYM"}	f	3	t	f	\N
022f848f-633f-4eb3-a5bd-8fc68f27ea56	60dcabc1-89b4-4e0c-a3cc-db96a05caca5	Test Activities	text	{"text": ""}	f	0	t	f	\N
57373ec3-327b-495f-9243-0b0ff3dcd3a9	abccd308-abc1-4433-ac35-207d0c2a3dbc	Adobe Smart Dress	show-video	{"fileUrl": "https://youtube.com/shorts/JLXzte8lwHw?si=Nw14MRgyyRslrQyl"}	f	0	t	f	\N
f2601c2e-7665-4ec0-b499-1fcf2687ebaa	abccd308-abc1-4433-ac35-207d0c2a3dbc	Shape Memory Metals	show-video	{"fileUrl": "https://youtu.be/EctisdaJv8I?si=J3yeX6mzscdw_uaV"}	f	1	t	f	\N
d54f8064-12cf-453c-bb9e-294c4552b38e	abccd308-abc1-4433-ac35-207d0c2a3dbc	Shape memory Alloys	show-video	{"fileUrl": "https://youtube.com/shorts/Lq3zr2wo7dM?si=ZQ_WR-aHBaMbEO1O"}	f	2	t	f	\N
2f2ca823-815c-4597-a095-bac4a89f0ac3	abccd308-abc1-4433-ac35-207d0c2a3dbc	Flame Blanket	show-video	{"fileUrl": "https://youtube.com/shorts/bvNiyEtYawc?si=pyqzWjh96n_8wai_"}	f	3	t	f	\N
e0493be4-ec66-4465-80e4-154712b8849d	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	Test Activity	text	{"text": "Hello, this is a test activity!"}	f	0	t	f	\N
f7169062-49ff-4cc3-8cc0-ade1c351b419	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	Demo: Walkthrough Pyramid	text	{"text": ""}	f	1	t	f	\N
e5d1135b-3875-4de3-9d0f-96771aa9267d	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	Demo: Walkthrough Prism	text	{"text": ""}	f	0	t	f	\N
9d0b8824-ea63-4535-8941-e625cf502c33	4c6ae118-4296-4830-a82a-aba00760e314	Starter: Draw 3 Icons that are related to Steam Punk	text	{"text": "5mins:\\n\\nOn scrap paper,  sketch 3 shapes that are related to the steam punk movement.\\n"}	f	0	t	f	\N
46ac8809-dd36-475b-bfe9-c62e2b330543	4c6ae118-4296-4830-a82a-aba00760e314	Discuss:  How To Ideate 15 Images	text	{"text": "Review the process of 5x3 grid to ideate images."}	f	1	t	f	\N
a4e84037-85a7-4366-a1b6-00baf3f6b9b7	4c6ae118-4296-4830-a82a-aba00760e314	Discuss Expectations	text	{"text": "Initial Sketches are for exploring shapes and ideas and can be rough.\\n\\nSelected Ideas are for developing your ideas and should be to DT standard (Outlined, colours, annotated).\\n"}	f	2	t	f	\N
cc9011a4-e74f-4f84-9187-873d76dbdac7	ca8445e2-364b-410d-922f-57c1c2f9bf44	Download This File	file-download	\N	f	3	t	f	\N
578f8c15-1a95-4b39-881d-28b8afb542e2	ca8445e2-364b-410d-922f-57c1c2f9bf44	Listen	voice	{"size": 11753, "duration": 5.012, "mimeType": "audio/webm;codecs=opus", "audioFile": "voice-1759276350915.webm"}	f	2	t	f	\N
c583cd10-0f45-41ba-9ce6-a61e602616fd	bb677055-41fb-4522-839e-741bd4376f85	Introduction to Access FM	display-image	{"size": 208682, "text": "Intro to Access FM to has a framework to FULLY describe a product.", "fileUrl": "Accessfm.jpg", "imageUrl": null, "mimeType": "image/jpeg", "imageFile": "Accessfm.jpg"}	f	0	t	f	\N
dc284777-4156-45c2-a61f-3d9b2fe7a5c1	4c6ae118-4296-4830-a82a-aba00760e314	Produce 15 Initial Sketches and 3 Selected Sketches	text	{"text": "In rough paper, produce a 3x5 grid of initial ideas.\\nIn your art book, sketch and annotate 3 selcted ideas."}	t	3	t	f	\N
9e342d8f-3888-4355-8628-3a1676fe97ba	ca8445e2-364b-410d-922f-57c1c2f9bf44	New Video.....	show-video	{"fileUrl": "https://www.youtube.com/watch?v=uvuymfuJx9Y"}	f	1	t	f	\N
f4af7944-8445-48d6-b142-68669cb69e3b	ca8445e2-364b-410d-922f-57c1c2f9bf44	Upload Initial Ideas	upload-file	{"instructions": "Upload your initial ideas here..."}	t	5	t	f	\N
f5f11d8e-5b0d-4ce8-b0f6-fe3f6194d269	4c6ae118-4296-4830-a82a-aba00760e314	Complete 3 Initial Sketches to DT Standards	text	{"text": "Take 3 of your initial ideas and draw them in the back of your art book, to DT standards (outline, coloured, shaded, etc)"}	t	4	t	f	\N
8583feed-2f15-4b02-afda-4c0de41a0417	8115af17-90c5-4e35-aa58-722afd856ace	Download File	file-download	\N	f	2	t	f	\N
6644dadd-c4cd-433b-93b0-35a093c175df	bb677055-41fb-4522-839e-741bd4376f85	Design Spec - Candle Holder	text	{"text": "In your art books, write a design spec for your Candle Holder."}	t	4	t	f	\N
9c97dda2-1955-4f6a-a176-d560be5535c7	07bf233b-a07f-426b-948d-486cbb43b204	Starter: Review Ideation Process (Ideation)	text	{"text": "Need: Scrap Paper<div><br></div><div><b>Task:</b>&nbsp; You have <b>5 mins</b> to create as many different pencil case designs as you can.</div>"}	f	0	t	f	\N
1c0c43f4-d36b-4e14-be92-60dcdc0772fd	07bf233b-a07f-426b-948d-486cbb43b204	Never Run Out Of Ideas	show-video	{"fileUrl": "https://youtu.be/71vvkT2aaUQ?si=0T0bNi14-gNqL5nu"}	f	1	t	f	\N
6a8fda20-d776-43c1-bf7c-7410d0b013b1	92a3d29d-8cb4-464f-8f67-83c7f8f4aba3	Discuss	text	{"text": ""}	f	0	t	f	\N
890ea4cb-63e0-4e21-bf57-d5d31b23cb85	92a3d29d-8cb4-464f-8f67-83c7f8f4aba3	Discuss Somethign else	text	{"text": ""}	f	1	t	f	\N
7d48476d-9682-482a-932c-52fe3b9b345e	8115af17-90c5-4e35-aa58-722afd856ace	Description	text	{"text": "Download the following file.\\nRecreate each shape as a 3D model.\\nYou should a new part studio for each model.\\nTake a screenshot of each model and paste it on to a slide of a powerpoint.\\n\\nOnce compete, upload the slide to teams"}	f	0	t	f	\N
5ae9fa78-4e13-4562-9e80-2e4991396104	b576b985-26c9-4f86-a465-b683d657f5d7	Test Image	display-image	{"size": 523457, "fileUrl": "0-1.jpg", "imageUrl": null, "mimeType": "image/jpeg", "imageFile": "0-1.jpg"}	f	0	t	f	\N
9c9972a4-f76f-49f7-a5cf-80ac1e646d79	b576b985-26c9-4f86-a465-b683d657f5d7	File Upload	upload-file	{"instructions": ""}	f	1	t	f	\N
0b38c5fb-230c-4b49-a907-476c2782b326	b576b985-26c9-4f86-a465-b683d657f5d7	Lesson Feedback	feedback	{"groups": {}}	f	3	t	f	\N
18e72100-1217-43f5-b15d-fc3185763bfd	07bf233b-a07f-426b-948d-486cbb43b204	Ideation Process	text	{"text": "<b>Task:</b> You now have 5 mins to create as many different pencil case designs as you can."}	f	2	t	f	\N
ce5c1942-6e43-4fb1-a6cf-40e1f2969322	07bf233b-a07f-426b-948d-486cbb43b204	Lesson Worksheet	display-image	{"size": 65983, "fileUrl": "Initial-IDeas WS.jpeg", "imageUrl": null, "mimeType": "image/jpeg", "imageFile": "Initial-IDeas WS.jpeg"}	f	3	t	f	\N
1585e0c0-d54b-42d0-ac9e-a0c618347f8e	07bf233b-a07f-426b-948d-486cbb43b204	Expectations:	display-image	{"size": 177828, "fileUrl": "Slide3.jpeg", "imageUrl": null, "mimeType": "image/jpeg", "imageFile": "Slide3.jpeg"}	f	4	t	f	\N
bc6bb66c-560f-4329-92da-bc37eece74c0	07bf233b-a07f-426b-948d-486cbb43b204	Task:  Create 15 Initial Sketches & 1 Selected Sketch	text	{"text": "In the worksheet, create 15 initial sketches.<div>Then create 1 selected design.</div>"}	t	5	t	f	\N
d4f4fe11-61fc-4253-9b04-08a3c62b9645	a1cad678-35ea-4a5b-b799-12ac2eb7c51f	Main Task:	display-image	{"size": 301559, "fileUrl": "Assessment Question.jpeg", "imageUrl": null, "mimeType": "image/jpeg", "imageFile": "Assessment Question.jpeg"}	f	1	t	f	\N
f46a30c5-6ea6-474b-b086-02e434cad5f5	8115af17-90c5-4e35-aa58-722afd856ace	Practice Shapes	display-image	{"size": 28812, "fileUrl": "practice_1.jpeg", "imageUrl": null, "mimeType": "image/jpeg", "imageFile": "practice_1.jpeg"}	f	1	t	f	\N
4a209992-6b5f-4674-ab68-f8a06fb51d09	47cbfb42-2e8d-4ee7-ac0e-b732f95ab8c1	Starter: Prototype	text	{"text": "Write 3 reasons why we prototype designs."}	f	0	t	f	\N
81b4e7a5-ebf4-4abd-9ac5-20e647c76fb5	47cbfb42-2e8d-4ee7-ac0e-b732f95ab8c1	Task: Flat Prototype	text	{"text": "Create a flat prototype for your design. &nbsp;<div>Ensure that any moving parts are represented in your prototype.</div>"}	f	1	t	f	\N
17adbcc6-5585-4589-86d8-e2e3afb5f709	b576b985-26c9-4f86-a465-b683d657f5d7	MCQ	multiple-choice-question	{"options": [{"id": "option-a", "text": "1", "imageUrl": null}, {"id": "option-b", "text": "2", "imageUrl": null}, {"id": "option-c", "text": "3", "imageUrl": null}, {"id": "option-d", "text": "4", "imageUrl": null}], "imageAlt": null, "imageUrl": null, "question": "Test&nbsp;", "imageFile": null, "correctOptionId": "option-a"}	f	2	t	f	\N
95082941-ab25-4576-b474-aff7b82d6476	0c60fa60-a7ed-47f5-822e-94b3a02dc3a2	AFL for 5B's	multiple-choice-question	{"options": [{"id": "option-a", "text": "Break", "imageUrl": null}, {"id": "option-b", "text": "Buddy", "imageUrl": null}, {"id": "option-c", "text": "Browse", "imageUrl": null}, {"id": "option-d", "text": "Breakfast", "imageUrl": null}], "imageAlt": null, "imageUrl": null, "question": "Which is not a B", "imageFile": null, "correctOptionId": "option-d"}	f	0	t	f	\N
70ca3f51-547d-4ab8-bcca-f57c7ba72afa	a1cad678-35ea-4a5b-b799-12ac2eb7c51f	Assesmment: Warm Up	text	{"text": "On the back of your .dot paper:<div><br></div><div>Draw 3 light lines</div><div>Draw 2 Outlines</div><div>Ghost a 2D circle.</div>"}	f	0	t	f	\N
70790e69-9c81-433f-92e7-b5760e672c07	dd003478-e764-48a6-b3c5-29449b365cec	Homework	text	{"text": "Create 3 Initial Designs and 1 selected design for your paper plane.<br><br>Remember that you must :<br>Outline<br>Annotate<br>Colour<div>Your final design</div>"}	t	0	t	f	\N
11b93371-eaf0-4871-9576-c9189cb0def0	9e810b7a-7a64-4adf-9d10-c60550273b49	Make Plane	text	{"text": ""}	f	0	t	f	\N
fd47b4ab-3b72-4ddc-94ff-e8f02a561230	9e810b7a-7a64-4adf-9d10-c60550273b49	Evaluate Plane	text	{"text": ""}	f	1	t	f	\N
dccefe60-c3f0-4872-9a46-386653da241c	a1cad678-35ea-4a5b-b799-12ac2eb7c51f	Upload your work	short-text-question	{"question": "No action required", "modelAnswer": "no asnwer required"}	f	2	t	t	\N
8ceb10e0-2cbd-429a-b9a5-50fe3f6ac5b0	0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	Submit Work	upload-file	{"instructions": ""}	f	0	t	f	\N
\.


--
-- Data for Name: activity_success_criteria; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."activity_success_criteria" ("activity_id", "success_criteria_id") FROM stdin;
17adbcc6-5585-4589-86d8-e2e3afb5f709	32c9e025-e8ad-4d50-b25c-c59d2524b0cd
17adbcc6-5585-4589-86d8-e2e3afb5f709	6bfdf9bd-d381-4313-b4b3-d0c6d1968a48
95082941-ab25-4576-b474-aff7b82d6476	32c9e025-e8ad-4d50-b25c-c59d2524b0cd
dccefe60-c3f0-4872-9a46-386653da241c	f53315cb-f3b0-4328-8133-1f2c91f91bfe
dccefe60-c3f0-4872-9a46-386653da241c	b59cca57-9e74-4a95-ad37-5db8c3383ebc
dccefe60-c3f0-4872-9a46-386653da241c	c6027ce2-2cb1-427e-8130-81ed9fac5d93
dccefe60-c3f0-4872-9a46-386653da241c	37fccff6-414c-463c-8d20-68489df1e0f3
6644dadd-c4cd-433b-93b0-35a093c175df	37864689-b68e-4958-810e-0492af84cec9
6644dadd-c4cd-433b-93b0-35a093c175df	279542cb-7139-467a-9cc3-0dda362fe8aa
dccefe60-c3f0-4872-9a46-386653da241c	9975d1de-864a-4175-861b-ffa70938efbd
dccefe60-c3f0-4872-9a46-386653da241c	e02cecb6-8178-4a08-8698-432a566f922d
8ceb10e0-2cbd-429a-b9a5-50fe3f6ac5b0	7de602d1-30dd-481f-84c2-a427345db200
8ceb10e0-2cbd-429a-b9a5-50fe3f6ac5b0	581aa31f-1c68-4599-9bfd-268185ec46ee
8ceb10e0-2cbd-429a-b9a5-50fe3f6ac5b0	2e92cb9a-55be-40f1-bede-76e16e008711
8ceb10e0-2cbd-429a-b9a5-50fe3f6ac5b0	0c161717-84a3-488b-9588-0cd19418fd0a
8ceb10e0-2cbd-429a-b9a5-50fe3f6ac5b0	bd0c1b0e-26d4-4447-8dde-2d068014ba50
8ceb10e0-2cbd-429a-b9a5-50fe3f6ac5b0	4012d28f-87b1-4fe6-9156-66e144dc717e
8ceb10e0-2cbd-429a-b9a5-50fe3f6ac5b0	61b92e1a-896e-4c1a-b453-5e706d679350
8ceb10e0-2cbd-429a-b9a5-50fe3f6ac5b0	5a684b30-147c-4072-9a12-848f4d751fd9
8ceb10e0-2cbd-429a-b9a5-50fe3f6ac5b0	e6434c7d-7d8d-42dd-99ff-57980bd7a8fd
8ceb10e0-2cbd-429a-b9a5-50fe3f6ac5b0	f6838e26-11b8-4918-9eec-3f880078d6a6
8ceb10e0-2cbd-429a-b9a5-50fe3f6ac5b0	040ee0f2-9508-42ea-980f-77b63f8d1d59
\.


--
-- Data for Name: curricula; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."curricula" ("curriculum_id", "subject", "title", "description", "active") FROM stdin;
30d9619d-f29e-419a-862b-e8e57eb2f68e	Design Technology	Design and Technology - KS3	\N	t
cee8b443-bf65-46f2-89d2-2f27c00ba031	Computing	Computing - KS3	\N	t
f197406b-d309-436f-9063-46bb8f3c2d89	Design Technology	Design and Technology - KS4	\N	t
7cf0c187-c196-49df-98dc-22d68c216ea2	Design Technology	Test Curriculum - TBD	\N	f
cb26ccd4-e21d-4284-adee-2cf4279d6540	Design Technology	Test Curriculum 2	\N	f
68d46181-9b4e-49a9-8a19-6d2c4c919269	Design Technology	Learn Onshape (Core)	\N	t
6f7845a1-4631-4e65-bf3f-86940c78b148	ICT	ICT - Yr 10	\N	t
\.


--
-- Data for Name: assessment_objectives; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."assessment_objectives" ("assessment_objective_id", "curriculum_id", "unit_id", "code", "title", "order_index") FROM stdin;
0c718c20-dd56-4057-8303-d66e94f4876a	30d9619d-f29e-419a-862b-e8e57eb2f68e	\N	AO1	Investigate	0
30b7bd6c-a557-4742-8a86-305e73e51405	30d9619d-f29e-419a-862b-e8e57eb2f68e	\N	AO2	Design and Make	1
4a95a07c-f16e-4e00-af9c-1de772281ccd	30d9619d-f29e-419a-862b-e8e57eb2f68e	\N	AO3	Evaluate	2
bdde6eb2-c4c1-45cd-aca5-bc12f5cff3da	30d9619d-f29e-419a-862b-e8e57eb2f68e	\N	AO4	Knowledge	3
0093f351-651b-4596-8ebf-2fb4ece3d69d	68d46181-9b4e-49a9-8a19-6d2c4c919269	\N	AO1	Produce 3D Solid Models for Production.	0
0adc9fbc-0e55-40a9-a171-724900002ae2	cee8b443-bf65-46f2-89d2-2f27c00ba031	\N	AO1	Knowledge	0
068e78c6-f10f-415f-bd92-5911863de95d	cee8b443-bf65-46f2-89d2-2f27c00ba031	\N	AO2	Application	1
2d75e3d1-b9df-4a00-a98d-4125bf621c84	cee8b443-bf65-46f2-89d2-2f27c00ba031	\N	AO3	Analysis	2
628c4da2-9e81-4418-a09d-35ef15d60664	f197406b-d309-436f-9063-46bb8f3c2d89	\N	AO1	Demonstrate knowledge and understanding of design and technology, including principles, processes, and materials.	0
3553266c-30e4-4d62-8d50-8df7c4405e5f	f197406b-d309-436f-9063-46bb8f3c2d89	\N	AO2	Apply knowledge and understanding of design and technology when designing and making products.	1
8cc414a8-97b2-4c86-8c9b-59281de29e06	f197406b-d309-436f-9063-46bb8f3c2d89	\N	AO3	Analyse and evaluate design decisions and outcomes, including for prototypes and products made by themselves and others.	2
796657b2-5194-4791-9a57-30913527ff55	f197406b-d309-436f-9063-46bb8f3c2d89	\N	AO4	Demonstrate and apply technical skills in making, testing, and refining design ideas and products.	3
0ef6384a-70f8-4870-8fdb-9515226feb8d	68d46181-9b4e-49a9-8a19-6d2c4c919269	\N	AO2	New assessment objective	1
51008e73-7d49-406c-82ce-a47574ab0466	7cf0c187-c196-49df-98dc-22d68c216ea2	\N	AO1	Investigate	0
5e7c520a-8fae-4335-a038-8a13836440b7	7cf0c187-c196-49df-98dc-22d68c216ea2	\N	AO4	Knowledge	1
40dfd5c1-b40d-434c-a2b9-be5b46b0806e	cb26ccd4-e21d-4284-adee-2cf4279d6540	\N	AO1	Investigate	0
70eff390-4af4-4468-98dd-b9c72a921da8	cb26ccd4-e21d-4284-adee-2cf4279d6540	\N	AO4	Knowledge	1
1e48e7ad-3bc4-4cdf-9499-8fe43eeb362a	6f7845a1-4631-4e65-bf3f-86940c78b148	\N	AO1	New assessment objective	0
\.


--
-- Data for Name: assignments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."assignments" ("group_id", "unit_id", "start_date", "end_date", "active") FROM stdin;
25-10-MA	UNIT001	2023-10-01	2023-10-31	t
25-11-SC	UNIT002	2023-10-01	2023-10-31	t
25-10-HI	UNIT003	2025-09-28	2025-10-04	f
25-10-HI	UNIT003	2025-09-21	2025-10-04	t
25-10-DT	UNIT004	2025-09-14	2025-09-20	f
25-11-DT	UNIT004	2025-09-14	2025-09-20	f
25-8A-DT	801-CANDLE-HOLDER	2025-09-21	2025-12-11	t
25-8B-DT	801-CANDLE-HOLDER	2025-09-21	2025-12-11	t
25-8C-DT	801-CANDLE-HOLDER	2025-09-21	2025-12-11	t
25-8D-DT	801-CANDLE-HOLDER	2025-09-21	2025-12-11	t
25-7A-IT	CATS	2025-09-21	2025-10-04	t
25-8C-IT	HTML	2025-09-07	2025-09-20	f
25-7C-IT	CATS	2025-09-21	2025-10-04	t
25-7D-IT	CATS	2025-09-21	2025-10-04	t
25-7B-IT	CATS	2025-09-21	2025-10-04	t
25-10-DT	10-2-ONSHAPE-BASIC-SKILLS	2025-09-14	2025-10-25	t
25-8D-IT	HTML	2025-09-07	2025-09-20	f
25-8A-IT	INDUCTION	2025-09-07	2025-09-20	t
25-8B-IT	INDUCTION	2025-09-07	2025-09-20	t
25-9A-DT	UNIT004	2025-09-21	2025-12-20	t
25-9B-DT	UNIT004	2025-09-21	2025-12-20	t
25-9C-DT	UNIT004	2025-09-21	2025-12-20	t
25-9D-DT	UNIT004	2025-09-21	2025-12-20	t
25-8A-DT	INDUCTION	2025-09-21	2025-09-27	f
25-8B-DT	INDUCTION	2025-09-21	2025-09-27	f
25-8D-DT	INDUCTION	2025-09-21	2025-09-27	f
25-8C-DT	INDUCTION	2025-09-21	2025-09-27	f
25-8A-IT	INDUCTION	2025-09-21	2025-09-27	f
25-10-DT	1001-CORE-1	2025-09-07	2025-12-20	t
25-8B-DT	DT-INDUCTION	2025-09-07	2025-09-20	t
25-8A-DT	DT-INDUCTION	2025-09-07	2025-09-20	t
25-8D-DT	DT-INDUCTION	2025-09-07	2025-09-20	t
25-11-DT	701-ISOMETRIC-SKETCHING	2025-09-21	2025-10-11	f
25-11-DT	1001-CORE-1	2025-09-14	2025-10-25	t
25-7A-DT	DT-INDUCTION	2025-09-07	2025-09-13	t
25-8C-IT	INDUCTION	2025-09-07	2025-09-20	t
25-8D-IT	INDUCTION	2025-09-07	2025-09-20	t
25-7B-DT	DT-INDUCTION	2025-09-07	2025-09-13	t
25-8A-IT	HTML	2025-09-21	2025-10-25	t
25-7D-DT	DT-INDUCTION	2025-09-07	2025-09-13	t
25-7C-DT	DT-INDUCTION	2025-09-07	2025-09-13	t
25-7A-DT	701-ISOMETRIC-SKETCHING	2025-09-14	2025-11-15	t
25-7B-DT	701-ISOMETRIC-SKETCHING	2025-09-14	2025-11-15	t
25-8B-IT	HTML	2025-09-21	2025-10-25	t
25-7D-DT	701-ISOMETRIC-SKETCHING	2025-09-14	2025-11-15	t
25-7C-DT	701-ISOMETRIC-SKETCHING	2025-09-14	2025-11-15	t
25-7A-IT	BEBRAS-7	2025-11-02	2025-11-15	t
25-7B-IT	BEBRAS-7	2025-11-02	2025-11-15	t
25-7C-IT	BEBRAS-7	2025-11-02	2025-11-15	t
25-7D-IT	BEBRAS-7	2025-11-02	2025-11-15	t
25-8C-IT	HTML	2025-09-21	2025-10-25	t
25-8D-IT	HTML	2025-09-21	2025-10-25	t
25-8D-IT	MICROBIT	2025-11-02	2025-12-13	t
25-8C-IT	MICROBIT	2025-11-02	2025-12-13	t
25-8A-IT	MICROBIT	2025-11-02	2025-12-13	t
25-8B-IT	MICROBIT	2025-11-02	2025-12-13	t
25-7A-IT	INDUCTION	2025-09-08	2025-10-19	t
25-7B-IT	INDUCTION	2025-09-08	2025-10-19	t
25-7C-IT	INDUCTION	2025-09-08	2025-10-19	t
25-7D-IT	INDUCTION	2025-09-08	2025-10-19	t
25-7A-IT	SCRATCH-BASICS	2025-11-16	2025-12-07	t
25-7B-IT	SCRATCH-BASICS	2025-11-16	2025-12-07	t
25-7C-IT	SCRATCH-BASICS	2025-11-16	2025-12-07	t
25-7D-IT	SCRATCH-BASICS	2025-11-16	2025-12-07	t
25-8A-IT	HTML	2025-09-07	2025-09-20	f
25-8B-IT	HTML	2025-09-07	2025-09-20	f
25-9A-IT	0901-INDUCTION	2025-09-07	2025-10-25	t
25-9B-IT	0901-INDUCTION	2025-09-07	2025-10-25	t
25-9D-IT	0901-INDUCTION	2025-09-07	2025-10-25	t
25-9C-IT	0901-INDUCTION	2025-09-07	2025-10-25	t
25-9A-IT	ONTRO-TO-PYTHON-TURTLE	2025-11-02	2025-12-13	t
25-9B-IT	ONTRO-TO-PYTHON-TURTLE	2025-11-02	2025-12-13	t
25-9C-IT	ONTRO-TO-PYTHON-TURTLE	2025-11-02	2025-12-13	t
25-9D-IT	ONTRO-TO-PYTHON-TURTLE	2025-11-02	2025-12-13	t
25-9A-DT	DT-INDUCTION	2025-09-07	2025-09-20	f
25-9B-DT	DT-INDUCTION	2025-09-07	2025-09-20	f
25-9C-DT	DT-INDUCTION	2025-09-07	2025-09-20	f
25-9D-DT	DT-INDUCTION	2025-09-07	2025-09-20	f
25-9A-DT	KS3-QUICK-DESIGN	2025-09-07	2025-09-20	t
25-8A-DT	KS3-QUICK-DESIGN	2025-09-07	2025-09-20	t
25-8B-DT	KS3-QUICK-DESIGN	2025-09-07	2025-09-20	t
25-8D-DT	KS3-QUICK-DESIGN	2025-09-07	2025-09-20	t
25-8C-DT	KS3-QUICK-DESIGN	2025-09-07	2025-09-20	t
25-9B-DT	KS3-QUICK-DESIGN	2025-09-07	2025-09-20	t
25-9C-DT	KS3-QUICK-DESIGN	2025-09-07	2025-09-20	t
25-9D-DT	KS3-QUICK-DESIGN	2025-09-07	2025-09-20	t
25-7A-DT	DOOR-HANGER	2025-11-02	2025-12-13	t
25-7B-DT	DOOR-HANGER	2025-11-02	2025-12-13	t
25-7C-DT	DOOR-HANGER	2025-11-02	2025-12-13	t
25-7D-DT	DOOR-HANGER	2025-11-02	2025-12-13	t
\.


--
-- Data for Name: feedback; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."feedback" ("id", "user_id", "lesson_id", "success_criteria_id", "rating") FROM stdin;
547	e7a2170f-64e0-4314-9175-7be5e99e5577	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
537	e25087b7-f44d-4ea5-a469-5f9543d69bf1	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	-1
557	7fe51a55-fa11-4763-b075-acbf88b2fba3	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
566	72764b6b-f518-4d9f-b044-beebaf5da7b6	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
576	66b3ac3a-a491-4c2f-958c-d74151ec5618	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
585	3463a79d-c69a-4349-90d9-07b359099bf9	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
595	9ec0b86d-d060-4a2b-8841-5129ddc0ca27	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
609	037f394f-e8b8-493f-aee8-9cf230b84a8d	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
182	63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	0c60fa60-a7ed-47f5-822e-94b3a02dc3a2	32c9e025-e8ad-4d50-b25c-c59d2524b0cd	1
183	63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	0c60fa60-a7ed-47f5-822e-94b3a02dc3a2	6bfdf9bd-d381-4313-b4b3-d0c6d1968a48	1
184	63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	0c60fa60-a7ed-47f5-822e-94b3a02dc3a2	fa9fc3d7-d789-4aef-b4d9-afc48fa628e3	1
618	0f7f42d8-08c3-480e-ae49-fecd1f566e2a	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
628	6c39f828-ca07-4100-8415-0af0cf8d6e25	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
635	d4b7fb1a-fc13-4878-ac15-2ac89009449a	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
638	71fc12a2-b572-4853-869d-a31bbc71d7b7	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
641	9bfaa2e6-87ca-423c-af3a-b29b40f5f5db	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
536	e25087b7-f44d-4ea5-a469-5f9543d69bf1	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
548	e7a2170f-64e0-4314-9175-7be5e99e5577	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
558	7fe51a55-fa11-4763-b075-acbf88b2fba3	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
567	72764b6b-f518-4d9f-b044-beebaf5da7b6	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
577	04638d3b-cf50-4724-a566-4fbd3e266de5	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
586	3463a79d-c69a-4349-90d9-07b359099bf9	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
596	9ec0b86d-d060-4a2b-8841-5129ddc0ca27	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
610	037f394f-e8b8-493f-aee8-9cf230b84a8d	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
619	0f7f42d8-08c3-480e-ae49-fecd1f566e2a	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
636	d4b7fb1a-fc13-4878-ac15-2ac89009449a	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
639	dd25ed75-81f6-4275-b40a-78bb8c583b2a	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
642	9bfaa2e6-87ca-423c-af3a-b29b40f5f5db	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
645	6fd3433f-e468-4d21-b42b-36ea1ab60db7	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
648	e1ee44b9-0153-4d85-ab89-131b71189383	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
651	299700ea-30c7-4da4-996b-59f1ad159a19	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
654	2ec08e87-597a-4c62-91f5-7611d54019f7	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
657	8896700d-4f9e-466f-8b1b-f3d24de12076	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
660	e67e364e-6521-471f-afad-d1b2002733c7	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
663	6c3bc1a2-792e-434e-9098-27065b69bacf	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
666	25e0ec02-c0f2-4a5b-b705-49976155939d	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
668	bb07d668-59ac-4ce9-a11f-64193b347cf4	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
671	e19a785b-0e0f-40b4-b839-c6ba381f5351	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
674	59e6f57c-7b4e-4c5c-85c2-ae95990e692a	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
677	baa7c664-9065-4cb9-9baa-69d385e7bcbe	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
680	5a2b3e7a-2276-43b0-8bde-bec7677c3ed2	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
683	b2b6227a-0371-48be-8a6a-1ca741597953	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
686	0624a38a-8a1a-45f7-93a7-cba3b6c78794	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
689	c6502fb1-8970-456f-ab45-ff3ab0584dd3	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
692	6df706e1-deb4-4548-81cc-82d2fd481c05	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
695	a743e51a-3552-4915-8d77-edc57715a677	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
698	2709f3c7-a488-467c-9c44-de36e1e9efda	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
701	7ce65557-6f3b-4637-b771-b903f70ab024	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
704	41be1008-67a4-4e15-95fb-36f5c333f13f	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
705	346d62db-eb7a-4c5e-b798-7dec26f75302	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
708	46340dab-faa0-4f2d-8980-bf4c98d00c6c	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
740	346d62db-eb7a-4c5e-b798-7dec26f75302	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
742	46340dab-faa0-4f2d-8980-bf4c98d00c6c	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
744	a0380237-abea-4988-84c7-c9d43179d2be	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
746	f69e0ef5-9d5b-41bf-857b-c78e20e75c1d	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
748	f6bdf187-d0bc-4c37-8034-202cfb4fb6db	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
750	c4f2521e-86c2-43a6-a680-4f5b642c3dd7	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
752	964430f8-1194-4c00-a640-b795663c24e1	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
754	c0f570d7-9772-4a31-b5cd-d78e702f4dcb	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
756	ece878d8-6e44-4f37-b38b-99dbd19f5518	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
488	63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	be239da2-aad5-4b97-951c-2ef1548752c1	1
492	e25087b7-f44d-4ea5-a469-5f9543d69bf1	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	be239da2-aad5-4b97-951c-2ef1548752c1	1
496	1b83349c-3b8b-4ab0-aae9-470a4d085469	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	be239da2-aad5-4b97-951c-2ef1548752c1	1
764	0c66c9e3-ad69-4a39-be10-59c48d04c65a	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	-1
538	63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
539	47096e19-2f45-4b45-8e60-f9d71eef8168	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	be239da2-aad5-4b97-951c-2ef1548752c1	1
549	50174a72-4c63-464e-bc8f-76d0cdb9caf0	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
559	7fe51a55-fa11-4763-b075-acbf88b2fba3	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
568	72764b6b-f518-4d9f-b044-beebaf5da7b6	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
578	04638d3b-cf50-4724-a566-4fbd3e266de5	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
587	3463a79d-c69a-4349-90d9-07b359099bf9	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
597	b81d8ba6-e7e8-4ab9-a13e-126e3458110b	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
611	037f394f-e8b8-493f-aee8-9cf230b84a8d	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
620	0f7f42d8-08c3-480e-ae49-fecd1f566e2a	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
637	71fc12a2-b572-4853-869d-a31bbc71d7b7	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
640	dd25ed75-81f6-4275-b40a-78bb8c583b2a	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
643	693e7720-4a1b-4379-993d-4a99b1ab4c15	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
646	6fd3433f-e468-4d21-b42b-36ea1ab60db7	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
649	221ad246-e0a0-4f41-9fce-a245b9a857f7	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
652	299700ea-30c7-4da4-996b-59f1ad159a19	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
655	cb62c43b-aca7-491a-949d-fb395e5ae1e2	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
658	8896700d-4f9e-466f-8b1b-f3d24de12076	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
661	14b19cda-dd95-4ead-bf2e-9cb53d0c9524	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
664	6c3bc1a2-792e-434e-9098-27065b69bacf	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
669	a8bb99b2-5bf9-4b92-9e54-2c1843b7300b	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
672	e19a785b-0e0f-40b4-b839-c6ba381f5351	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
675	1ceb90c6-1724-47a9-a8ee-b360a9640298	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
678	baa7c664-9065-4cb9-9baa-69d385e7bcbe	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
681	0a976181-0665-4c8b-a843-bb4b743de561	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
684	b2b6227a-0371-48be-8a6a-1ca741597953	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
687	fc6f7281-baf1-4c72-81fe-b91e78dfc685	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
690	c6502fb1-8970-456f-ab45-ff3ab0584dd3	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
693	f4edc5de-aa0a-4cf1-8590-15275633126e	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
696	a743e51a-3552-4915-8d77-edc57715a677	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
699	5e569c2b-17ee-4b5d-af58-820b9c9882df	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
702	7ce65557-6f3b-4637-b771-b903f70ab024	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
706	346d62db-eb7a-4c5e-b798-7dec26f75302	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
709	a0380237-abea-4988-84c7-c9d43179d2be	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
758	7e3f6a84-e2ec-458c-953e-bb83bd693ecc	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
760	0503adf6-4e05-4f0d-8802-660dcfbee96c	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
762	969dbda5-2815-41e3-84bd-d14dd102eb39	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
766	24d1c27d-3365-4ceb-8909-c9c08444af9f	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
768	81a9b148-9ff0-4678-8178-1fe37e8afe72	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
770	cbc7e991-08eb-4838-a10c-3ea2cb10e2d8	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
202	d4b7fb1a-fc13-4878-ac15-2ac89009449a	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
203	71fc12a2-b572-4853-869d-a31bbc71d7b7	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
204	dd25ed75-81f6-4275-b40a-78bb8c583b2a	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
205	9bfaa2e6-87ca-423c-af3a-b29b40f5f5db	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
206	693e7720-4a1b-4379-993d-4a99b1ab4c15	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
207	6fd3433f-e468-4d21-b42b-36ea1ab60db7	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
209	221ad246-e0a0-4f41-9fce-a245b9a857f7	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
210	299700ea-30c7-4da4-996b-59f1ad159a19	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
211	8896700d-4f9e-466f-8b1b-f3d24de12076	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
212	cb62c43b-aca7-491a-949d-fb395e5ae1e2	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
213	2ec08e87-597a-4c62-91f5-7611d54019f7	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
214	14b19cda-dd95-4ead-bf2e-9cb53d0c9524	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
215	6c3bc1a2-792e-434e-9098-27065b69bacf	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
216	25e0ec02-c0f2-4a5b-b705-49976155939d	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
208	e1ee44b9-0153-4d85-ab89-131b71189383	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	-1
218	e67e364e-6521-471f-afad-d1b2002733c7	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	-1
265	0624a38a-8a1a-45f7-93a7-cba3b6c78794	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
266	fc6f7281-baf1-4c72-81fe-b91e78dfc685	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
267	c6502fb1-8970-456f-ab45-ff3ab0584dd3	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
268	6df706e1-deb4-4548-81cc-82d2fd481c05	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
540	47096e19-2f45-4b45-8e60-f9d71eef8168	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	f9966d00-d4a0-43b1-add4-6e4201ffe96b	-1
550	50174a72-4c63-464e-bc8f-76d0cdb9caf0	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
569	8aa0e2ec-19f2-423d-b8c4-697539e010a0	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
588	3463a79d-c69a-4349-90d9-07b359099bf9	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
600	b81d8ba6-e7e8-4ab9-a13e-126e3458110b	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
269	f4edc5de-aa0a-4cf1-8590-15275633126e	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
489	63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	f9966d00-d4a0-43b1-add4-6e4201ffe96b	1
271	2709f3c7-a488-467c-9c44-de36e1e9efda	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
272	5e569c2b-17ee-4b5d-af58-820b9c9882df	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
273	7ce65557-6f3b-4637-b771-b903f70ab024	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
274	41be1008-67a4-4e15-95fb-36f5c333f13f	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
258	e19a785b-0e0f-40b4-b839-c6ba381f5351	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	-1
270	a743e51a-3552-4915-8d77-edc57715a677	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	-1
313	63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	cedd9f2e-34c0-46ed-88a5-a3fdfd9fc7cf	32c9e025-e8ad-4d50-b25c-c59d2524b0cd	1
314	63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	cedd9f2e-34c0-46ed-88a5-a3fdfd9fc7cf	6bfdf9bd-d381-4313-b4b3-d0c6d1968a48	1
315	63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	cedd9f2e-34c0-46ed-88a5-a3fdfd9fc7cf	fa9fc3d7-d789-4aef-b4d9-afc48fa628e3	1
316	d4b7fb1a-fc13-4878-ac15-2ac89009449a	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
493	e25087b7-f44d-4ea5-a469-5f9543d69bf1	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	f9966d00-d4a0-43b1-add4-6e4201ffe96b	1
257	a8bb99b2-5bf9-4b92-9e54-2c1843b7300b	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
259	59e6f57c-7b4e-4c5c-85c2-ae95990e692a	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
260	1ceb90c6-1724-47a9-a8ee-b360a9640298	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
261	baa7c664-9065-4cb9-9baa-69d385e7bcbe	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
262	5a2b3e7a-2276-43b0-8bde-bec7677c3ed2	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
263	0a976181-0665-4c8b-a843-bb4b743de561	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
264	b2b6227a-0371-48be-8a6a-1ca741597953	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	5ce786a4-2aff-475d-9d50-e06ebc06a94a	1
317	d4b7fb1a-fc13-4878-ac15-2ac89009449a	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
318	71fc12a2-b572-4853-869d-a31bbc71d7b7	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
319	71fc12a2-b572-4853-869d-a31bbc71d7b7	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
320	dd25ed75-81f6-4275-b40a-78bb8c583b2a	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
321	dd25ed75-81f6-4275-b40a-78bb8c583b2a	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
612	037f394f-e8b8-493f-aee8-9cf230b84a8d	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
621	aede0bdf-1c12-4a7b-a17b-aa619485ac96	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
644	693e7720-4a1b-4379-993d-4a99b1ab4c15	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
647	e1ee44b9-0153-4d85-ab89-131b71189383	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
322	9bfaa2e6-87ca-423c-af3a-b29b40f5f5db	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
325	693e7720-4a1b-4379-993d-4a99b1ab4c15	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
328	e1ee44b9-0153-4d85-ab89-131b71189383	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
331	221ad246-e0a0-4f41-9fce-a245b9a857f7	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
334	2ec08e87-597a-4c62-91f5-7611d54019f7	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
337	cb62c43b-aca7-491a-949d-fb395e5ae1e2	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
340	e67e364e-6521-471f-afad-d1b2002733c7	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
343	14b19cda-dd95-4ead-bf2e-9cb53d0c9524	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
347	25e0ec02-c0f2-4a5b-b705-49976155939d	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
348	bb07d668-59ac-4ce9-a11f-64193b347cf4	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
351	a8bb99b2-5bf9-4b92-9e54-2c1843b7300b	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
354	59e6f57c-7b4e-4c5c-85c2-ae95990e692a	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
357	1ceb90c6-1724-47a9-a8ee-b360a9640298	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
360	5a2b3e7a-2276-43b0-8bde-bec7677c3ed2	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
490	3352f5a2-3c8b-420e-90b7-d95ab6f1756c	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	be239da2-aad5-4b97-951c-2ef1548752c1	1
494	a59a492b-cb3d-499e-9152-1b0793ce7b44	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	be239da2-aad5-4b97-951c-2ef1548752c1	1
498	da365bd8-7aa5-4ffb-acf0-2afaaf7152b6	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	be239da2-aad5-4b97-951c-2ef1548752c1	1
497	1b83349c-3b8b-4ab0-aae9-470a4d085469	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	f9966d00-d4a0-43b1-add4-6e4201ffe96b	-1
551	50174a72-4c63-464e-bc8f-76d0cdb9caf0	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
560	7fe51a55-fa11-4763-b075-acbf88b2fba3	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
570	8aa0e2ec-19f2-423d-b8c4-697539e010a0	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
579	04638d3b-cf50-4724-a566-4fbd3e266de5	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
598	b81d8ba6-e7e8-4ab9-a13e-126e3458110b	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
604	d63b381b-362f-4467-8127-258c736ae789	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
613	35a5544d-1d93-4354-b4d1-fd74497b917f	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
622	aede0bdf-1c12-4a7b-a17b-aa619485ac96	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
623	aede0bdf-1c12-4a7b-a17b-aa619485ac96	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
650	221ad246-e0a0-4f41-9fce-a245b9a857f7	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
653	2ec08e87-597a-4c62-91f5-7611d54019f7	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
656	cb62c43b-aca7-491a-949d-fb395e5ae1e2	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
659	e67e364e-6521-471f-afad-d1b2002733c7	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
662	14b19cda-dd95-4ead-bf2e-9cb53d0c9524	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
665	25e0ec02-c0f2-4a5b-b705-49976155939d	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
667	bb07d668-59ac-4ce9-a11f-64193b347cf4	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
670	a8bb99b2-5bf9-4b92-9e54-2c1843b7300b	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
673	59e6f57c-7b4e-4c5c-85c2-ae95990e692a	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
676	1ceb90c6-1724-47a9-a8ee-b360a9640298	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
679	5a2b3e7a-2276-43b0-8bde-bec7677c3ed2	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
682	0a976181-0665-4c8b-a843-bb4b743de561	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
685	0624a38a-8a1a-45f7-93a7-cba3b6c78794	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
688	fc6f7281-baf1-4c72-81fe-b91e78dfc685	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
691	6df706e1-deb4-4548-81cc-82d2fd481c05	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
694	f4edc5de-aa0a-4cf1-8590-15275633126e	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
697	2709f3c7-a488-467c-9c44-de36e1e9efda	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
700	5e569c2b-17ee-4b5d-af58-820b9c9882df	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
703	41be1008-67a4-4e15-95fb-36f5c333f13f	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
707	46340dab-faa0-4f2d-8980-bf4c98d00c6c	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
710	a0380237-abea-4988-84c7-c9d43179d2be	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
772	3bbc42b1-4ea6-48e3-84ad-6966551a3802	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
323	9bfaa2e6-87ca-423c-af3a-b29b40f5f5db	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
326	6fd3433f-e468-4d21-b42b-36ea1ab60db7	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
329	e1ee44b9-0153-4d85-ab89-131b71189383	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
332	299700ea-30c7-4da4-996b-59f1ad159a19	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
335	2ec08e87-597a-4c62-91f5-7611d54019f7	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
338	8896700d-4f9e-466f-8b1b-f3d24de12076	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
341	e67e364e-6521-471f-afad-d1b2002733c7	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
344	6c3bc1a2-792e-434e-9098-27065b69bacf	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
345	6c3bc1a2-792e-434e-9098-27065b69bacf	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
349	bb07d668-59ac-4ce9-a11f-64193b347cf4	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
352	e19a785b-0e0f-40b4-b839-c6ba381f5351	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
355	59e6f57c-7b4e-4c5c-85c2-ae95990e692a	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
358	baa7c664-9065-4cb9-9baa-69d385e7bcbe	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
491	3352f5a2-3c8b-420e-90b7-d95ab6f1756c	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	f9966d00-d4a0-43b1-add4-6e4201ffe96b	1
495	a59a492b-cb3d-499e-9152-1b0793ce7b44	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	f9966d00-d4a0-43b1-add4-6e4201ffe96b	1
499	da365bd8-7aa5-4ffb-acf0-2afaaf7152b6	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	f9966d00-d4a0-43b1-add4-6e4201ffe96b	-1
542	8f719803-c401-44e4-bf15-f4a5121457c4	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
552	50174a72-4c63-464e-bc8f-76d0cdb9caf0	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
561	48da2f2e-545c-4ba3-9538-c018c81c757f	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
571	8aa0e2ec-19f2-423d-b8c4-697539e010a0	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
580	04638d3b-cf50-4724-a566-4fbd3e266de5	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
590	27aea387-1140-456d-8094-5528755b8ebc	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
599	b81d8ba6-e7e8-4ab9-a13e-126e3458110b	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
605	d2023f55-f793-4f78-ac7c-2fcd4136917b	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
614	35a5544d-1d93-4354-b4d1-fd74497b917f	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
624	aede0bdf-1c12-4a7b-a17b-aa619485ac96	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
629	8f719803-c401-44e4-bf15-f4a5121457c4	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	-1
711	f69e0ef5-9d5b-41bf-857b-c78e20e75c1d	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
714	f6bdf187-d0bc-4c37-8034-202cfb4fb6db	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
717	964430f8-1194-4c00-a640-b795663c24e1	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
720	c0f570d7-9772-4a31-b5cd-d78e702f4dcb	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
723	7e3f6a84-e2ec-458c-953e-bb83bd693ecc	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
726	0503adf6-4e05-4f0d-8802-660dcfbee96c	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
729	0c66c9e3-ad69-4a39-be10-59c48d04c65a	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
732	24d1c27d-3365-4ceb-8909-c9c08444af9f	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
735	cbc7e991-08eb-4838-a10c-3ea2cb10e2d8	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
738	3bbc42b1-4ea6-48e3-84ad-6966551a3802	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
775	d4b7fb1a-fc13-4878-ac15-2ac89009449a	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
777	71fc12a2-b572-4853-869d-a31bbc71d7b7	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
779	dd25ed75-81f6-4275-b40a-78bb8c583b2a	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
781	9bfaa2e6-87ca-423c-af3a-b29b40f5f5db	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
785	6fd3433f-e468-4d21-b42b-36ea1ab60db7	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
787	e1ee44b9-0153-4d85-ab89-131b71189383	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
789	221ad246-e0a0-4f41-9fce-a245b9a857f7	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
791	299700ea-30c7-4da4-996b-59f1ad159a19	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
793	2ec08e87-597a-4c62-91f5-7611d54019f7	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
795	cb62c43b-aca7-491a-949d-fb395e5ae1e2	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
797	8896700d-4f9e-466f-8b1b-f3d24de12076	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
801	14b19cda-dd95-4ead-bf2e-9cb53d0c9524	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
803	6c3bc1a2-792e-434e-9098-27065b69bacf	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
805	25e0ec02-c0f2-4a5b-b705-49976155939d	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
783	693e7720-4a1b-4379-993d-4a99b1ab4c15	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	-1
799	e67e364e-6521-471f-afad-d1b2002733c7	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	-1
324	693e7720-4a1b-4379-993d-4a99b1ab4c15	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
327	6fd3433f-e468-4d21-b42b-36ea1ab60db7	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
330	221ad246-e0a0-4f41-9fce-a245b9a857f7	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
333	299700ea-30c7-4da4-996b-59f1ad159a19	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
336	cb62c43b-aca7-491a-949d-fb395e5ae1e2	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
339	8896700d-4f9e-466f-8b1b-f3d24de12076	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
342	14b19cda-dd95-4ead-bf2e-9cb53d0c9524	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
346	25e0ec02-c0f2-4a5b-b705-49976155939d	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
350	a8bb99b2-5bf9-4b92-9e54-2c1843b7300b	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
353	e19a785b-0e0f-40b4-b839-c6ba381f5351	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
356	1ceb90c6-1724-47a9-a8ee-b360a9640298	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
359	baa7c664-9065-4cb9-9baa-69d385e7bcbe	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
361	5a2b3e7a-2276-43b0-8bde-bec7677c3ed2	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
362	0a976181-0665-4c8b-a843-bb4b743de561	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
363	0a976181-0665-4c8b-a843-bb4b743de561	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
364	b2b6227a-0371-48be-8a6a-1ca741597953	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
365	b2b6227a-0371-48be-8a6a-1ca741597953	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
366	0624a38a-8a1a-45f7-93a7-cba3b6c78794	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
367	0624a38a-8a1a-45f7-93a7-cba3b6c78794	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
368	fc6f7281-baf1-4c72-81fe-b91e78dfc685	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
369	fc6f7281-baf1-4c72-81fe-b91e78dfc685	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
370	c6502fb1-8970-456f-ab45-ff3ab0584dd3	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
371	c6502fb1-8970-456f-ab45-ff3ab0584dd3	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
372	6df706e1-deb4-4548-81cc-82d2fd481c05	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
373	6df706e1-deb4-4548-81cc-82d2fd481c05	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
374	f4edc5de-aa0a-4cf1-8590-15275633126e	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
375	f4edc5de-aa0a-4cf1-8590-15275633126e	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
376	a743e51a-3552-4915-8d77-edc57715a677	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
377	a743e51a-3552-4915-8d77-edc57715a677	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
378	2709f3c7-a488-467c-9c44-de36e1e9efda	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
379	2709f3c7-a488-467c-9c44-de36e1e9efda	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
380	5e569c2b-17ee-4b5d-af58-820b9c9882df	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
381	5e569c2b-17ee-4b5d-af58-820b9c9882df	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
382	7ce65557-6f3b-4637-b771-b903f70ab024	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
383	7ce65557-6f3b-4637-b771-b903f70ab024	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
384	41be1008-67a4-4e15-95fb-36f5c333f13f	8d96130b-2336-46a1-a214-73ec4e7e980d	5f2b7707-db53-4b6f-9890-fa65f9154e6d	1
385	41be1008-67a4-4e15-95fb-36f5c333f13f	8d96130b-2336-46a1-a214-73ec4e7e980d	54b4e504-7bd3-4133-8d20-39b1ee29181d	1
553	87256a00-fff4-47a4-b64c-c32b48b8f3c3	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
562	48da2f2e-545c-4ba3-9538-c018c81c757f	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
572	8aa0e2ec-19f2-423d-b8c4-697539e010a0	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
581	9d9a3dfc-cf3e-4b12-acad-2ce5c4992fac	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
393	63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	5b4f0a5e-d001-443d-a141-1605d5f5d831	37fccff6-414c-463c-8d20-68489df1e0f3	1
394	63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	5b4f0a5e-d001-443d-a141-1605d5f5d831	83b146f2-718e-4bc7-bbbc-73382cb05575	1
395	3352f5a2-3c8b-420e-90b7-d95ab6f1756c	5b4f0a5e-d001-443d-a141-1605d5f5d831	37fccff6-414c-463c-8d20-68489df1e0f3	1
396	3352f5a2-3c8b-420e-90b7-d95ab6f1756c	5b4f0a5e-d001-443d-a141-1605d5f5d831	83b146f2-718e-4bc7-bbbc-73382cb05575	1
397	e25087b7-f44d-4ea5-a469-5f9543d69bf1	5b4f0a5e-d001-443d-a141-1605d5f5d831	37fccff6-414c-463c-8d20-68489df1e0f3	1
398	e25087b7-f44d-4ea5-a469-5f9543d69bf1	5b4f0a5e-d001-443d-a141-1605d5f5d831	83b146f2-718e-4bc7-bbbc-73382cb05575	1
399	a59a492b-cb3d-499e-9152-1b0793ce7b44	5b4f0a5e-d001-443d-a141-1605d5f5d831	37fccff6-414c-463c-8d20-68489df1e0f3	1
400	a59a492b-cb3d-499e-9152-1b0793ce7b44	5b4f0a5e-d001-443d-a141-1605d5f5d831	83b146f2-718e-4bc7-bbbc-73382cb05575	1
401	1b83349c-3b8b-4ab0-aae9-470a4d085469	5b4f0a5e-d001-443d-a141-1605d5f5d831	37fccff6-414c-463c-8d20-68489df1e0f3	1
402	1b83349c-3b8b-4ab0-aae9-470a4d085469	5b4f0a5e-d001-443d-a141-1605d5f5d831	83b146f2-718e-4bc7-bbbc-73382cb05575	1
403	da365bd8-7aa5-4ffb-acf0-2afaaf7152b6	5b4f0a5e-d001-443d-a141-1605d5f5d831	37fccff6-414c-463c-8d20-68489df1e0f3	1
404	da365bd8-7aa5-4ffb-acf0-2afaaf7152b6	5b4f0a5e-d001-443d-a141-1605d5f5d831	83b146f2-718e-4bc7-bbbc-73382cb05575	1
544	8f719803-c401-44e4-bf15-f4a5121457c4	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
554	87256a00-fff4-47a4-b64c-c32b48b8f3c3	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
563	48da2f2e-545c-4ba3-9538-c018c81c757f	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
573	66b3ac3a-a491-4c2f-958c-d74151ec5618	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
582	9d9a3dfc-cf3e-4b12-acad-2ce5c4992fac	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
592	27aea387-1140-456d-8094-5528755b8ebc	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
606	d2023f55-f793-4f78-ac7c-2fcd4136917b	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
615	35a5544d-1d93-4354-b4d1-fd74497b917f	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
625	6c39f828-ca07-4100-8415-0af0cf8d6e25	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
630	8f719803-c401-44e4-bf15-f4a5121457c4	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	-1
601	d63b381b-362f-4467-8127-258c736ae789	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	-1
712	f69e0ef5-9d5b-41bf-857b-c78e20e75c1d	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
715	c4f2521e-86c2-43a6-a680-4f5b642c3dd7	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
718	964430f8-1194-4c00-a640-b795663c24e1	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
721	ece878d8-6e44-4f37-b38b-99dbd19f5518	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
724	7e3f6a84-e2ec-458c-953e-bb83bd693ecc	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
727	969dbda5-2815-41e3-84bd-d14dd102eb39	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
730	0c66c9e3-ad69-4a39-be10-59c48d04c65a	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
733	81a9b148-9ff0-4678-8178-1fe37e8afe72	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
736	cbc7e991-08eb-4838-a10c-3ea2cb10e2d8	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
776	d4b7fb1a-fc13-4878-ac15-2ac89009449a	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
778	71fc12a2-b572-4853-869d-a31bbc71d7b7	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
780	dd25ed75-81f6-4275-b40a-78bb8c583b2a	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
782	9bfaa2e6-87ca-423c-af3a-b29b40f5f5db	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
786	6fd3433f-e468-4d21-b42b-36ea1ab60db7	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
788	e1ee44b9-0153-4d85-ab89-131b71189383	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
790	221ad246-e0a0-4f41-9fce-a245b9a857f7	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
792	299700ea-30c7-4da4-996b-59f1ad159a19	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
794	2ec08e87-597a-4c62-91f5-7611d54019f7	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
796	cb62c43b-aca7-491a-949d-fb395e5ae1e2	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
798	8896700d-4f9e-466f-8b1b-f3d24de12076	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
802	14b19cda-dd95-4ead-bf2e-9cb53d0c9524	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
804	6c3bc1a2-792e-434e-9098-27065b69bacf	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
806	25e0ec02-c0f2-4a5b-b705-49976155939d	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	1
784	693e7720-4a1b-4379-993d-4a99b1ab4c15	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	-1
800	e67e364e-6521-471f-afad-d1b2002733c7	bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9	-1
405	47096e19-2f45-4b45-8e60-f9d71eef8168	5b4f0a5e-d001-443d-a141-1605d5f5d831	37fccff6-414c-463c-8d20-68489df1e0f3	1
545	e7a2170f-64e0-4314-9175-7be5e99e5577	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
555	87256a00-fff4-47a4-b64c-c32b48b8f3c3	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
564	48da2f2e-545c-4ba3-9538-c018c81c757f	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
574	66b3ac3a-a491-4c2f-958c-d74151ec5618	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
583	9d9a3dfc-cf3e-4b12-acad-2ce5c4992fac	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
593	9ec0b86d-d060-4a2b-8841-5129ddc0ca27	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
602	d63b381b-362f-4467-8127-258c736ae789	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
607	d2023f55-f793-4f78-ac7c-2fcd4136917b	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
616	35a5544d-1d93-4354-b4d1-fd74497b917f	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
626	6c39f828-ca07-4100-8415-0af0cf8d6e25	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
631	27aea387-1140-456d-8094-5528755b8ebc	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
713	f6bdf187-d0bc-4c37-8034-202cfb4fb6db	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
716	c4f2521e-86c2-43a6-a680-4f5b642c3dd7	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
719	c0f570d7-9772-4a31-b5cd-d78e702f4dcb	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
722	ece878d8-6e44-4f37-b38b-99dbd19f5518	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
725	0503adf6-4e05-4f0d-8802-660dcfbee96c	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
728	969dbda5-2815-41e3-84bd-d14dd102eb39	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
731	24d1c27d-3365-4ceb-8909-c9c08444af9f	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
734	81a9b148-9ff0-4678-8178-1fe37e8afe72	79315679-c71e-4998-a121-3464829aaff1	ba323877-7a98-4982-8be5-a1b9dcf6798e	1
737	3bbc42b1-4ea6-48e3-84ad-6966551a3802	79315679-c71e-4998-a121-3464829aaff1	07a38c75-be31-4f22-a453-a66b48960543	1
406	47096e19-2f45-4b45-8e60-f9d71eef8168	5b4f0a5e-d001-443d-a141-1605d5f5d831	83b146f2-718e-4bc7-bbbc-73382cb05575	1
546	e7a2170f-64e0-4314-9175-7be5e99e5577	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
556	87256a00-fff4-47a4-b64c-c32b48b8f3c3	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
565	72764b6b-f518-4d9f-b044-beebaf5da7b6	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
575	66b3ac3a-a491-4c2f-958c-d74151ec5618	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
584	9d9a3dfc-cf3e-4b12-acad-2ce5c4992fac	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
594	9ec0b86d-d060-4a2b-8841-5129ddc0ca27	9d3dd129-0a25-4f9e-a793-7a6edb45518e	49a3ee17-169c-48be-86ec-9c42b07631b5	1
608	d2023f55-f793-4f78-ac7c-2fcd4136917b	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2b42771e-3968-4eae-920e-65b251daf732	1
617	0f7f42d8-08c3-480e-ae49-fecd1f566e2a	9d3dd129-0a25-4f9e-a793-7a6edb45518e	f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	1
627	6c39f828-ca07-4100-8415-0af0cf8d6e25	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
632	27aea387-1140-456d-8094-5528755b8ebc	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	1
603	d63b381b-362f-4467-8127-258c736ae789	9d3dd129-0a25-4f9e-a793-7a6edb45518e	7d9d3211-113e-4961-a536-84f3baa51028	-1
739	346d62db-eb7a-4c5e-b798-7dec26f75302	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
741	46340dab-faa0-4f2d-8980-bf4c98d00c6c	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
743	a0380237-abea-4988-84c7-c9d43179d2be	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
745	f69e0ef5-9d5b-41bf-857b-c78e20e75c1d	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
747	f6bdf187-d0bc-4c37-8034-202cfb4fb6db	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
749	c4f2521e-86c2-43a6-a680-4f5b642c3dd7	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
751	964430f8-1194-4c00-a640-b795663c24e1	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
753	c0f570d7-9772-4a31-b5cd-d78e702f4dcb	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
755	ece878d8-6e44-4f37-b38b-99dbd19f5518	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
757	7e3f6a84-e2ec-458c-953e-bb83bd693ecc	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
759	0503adf6-4e05-4f0d-8802-660dcfbee96c	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
761	969dbda5-2815-41e3-84bd-d14dd102eb39	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
765	24d1c27d-3365-4ceb-8909-c9c08444af9f	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
767	81a9b148-9ff0-4678-8178-1fe37e8afe72	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
769	cbc7e991-08eb-4838-a10c-3ea2cb10e2d8	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
771	3bbc42b1-4ea6-48e3-84ad-6966551a3802	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	1
763	0c66c9e3-ad69-4a39-be10-59c48d04c65a	bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa	-1
\.


--
-- Data for Name: groups; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."groups" ("group_id", "created_at", "join_code", "subject", "active") FROM stdin;
test 1	2025-09-19 13:03:45.763437+00	TLAMU	Science	f
test	2025-09-19 12:47:33.511516+00	ZAQQM	Mathematics	f
25-9-SC-1	2025-09-19 12:28:27.405256+00	A1YL8	Science	f
25-10-DT	2025-09-19 14:25:08.828462+00	LO4ER	Design Technology	t
25-12-SC	2025-09-19 15:59:35.564661+00	MA94Y	Science	f
25-11-MA	2025-09-19 12:13:05.524048+00	9GJ6I	Mathematics	f
25-10-HI	2025-09-19 11:10:04.761989+00	JOIN789	History	f
25-11-SC	2025-09-19 11:10:04.761989+00	JOIN456	Science	f
25-10-MA	2025-09-19 11:10:04.761989+00	JOIN123	Mathematics	f
25-11-DT	2025-09-20 14:00:36.049814+00	1H7BX	Design Technology	t
test-001	2025-09-20 14:47:42.307132+00	8NGVG	Mathematics	f
25-07-DT	2025-09-20 14:06:36.777019+00	Y70DB	Design Technology	f
25-7A-DT	2025-09-20 16:00:21.616613+00	E7PST	Design Technology	t
25-7B-DT	2025-09-20 16:00:43.311819+00	0PIBE	Design Technology	t
25-7C-DT	2025-09-20 16:00:53.785743+00	I2NBN	Design Technology	t
25-7D-DT	2025-09-20 16:01:05.125056+00	0LCU6	Design Technology	t
25-8A-DT	2025-09-20 16:25:27.630158+00	TM9JL	Design Technology	t
25-8B-DT	2025-09-20 16:25:41.109569+00	91DK5	Design Technology	t
25-8D-DT	2025-09-20 16:26:27.804059+00	WDVLT	Design Technology	t
25-7A-IT	2025-09-21 09:40:22.433495+00	8K9QJ	Computing	t
25-7B-IT	2025-09-21 09:41:21.255919+00	NPQAY	Computing	t
25-7C-IT	2025-09-21 09:41:50.134654+00	67U8D	Computing	t
25-7D-IT	2025-09-21 09:42:04.572643+00	17N03	Computing	t
25-8A-IT	2025-09-21 13:26:27.965128+00	0VGGH	Computing	t
25-8B-IT	2025-09-21 13:26:28.65029+00	9G0K2	Computing	t
25-8C-IT	2025-09-21 13:26:29.204477+00	78HRD	Computing	t
25-8D-IT	2025-09-21 13:26:29.539136+00	K8EN1	Computing	t
25-9A-IT	2025-09-21 13:27:12.071068+00	J5UC0	Computing	t
25-9B-IT	2025-09-21 13:27:12.66961+00	NCNY7	Computing	t
25-9C-IT	2025-09-21 13:27:13.323083+00	JI2UY	Computing	t
25-9D-IT	2025-09-21 13:27:13.986861+00	FYZAW	Computing	t
25-9A-DT	2025-09-21 13:27:58.107692+00	8A0O9	Design Technology	t
25-9B-DT25-9C-DT25-9D-DT	2025-09-21 13:27:58.639042+00	DM2OV	Design Technology	f
25-9B-DT	2025-09-21 13:29:00.212377+00	8KM01	Design Technology	t
25-9C-DT	2025-09-21 13:29:00.794177+00	M8352	Design Technology	t
25-9D-DT	2025-09-21 13:29:01.589882+00	CX2D1	Design Technology	t
25-8C-DT	2025-09-20 16:25:59.937745+00	9DFLI	Design Technology	t
\.


--
-- Data for Name: group_membership; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."group_membership" ("group_id", "user_id", "role") FROM stdin;
25-7A-DT	63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	pupil
25-7A-IT	63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	pupil
25-8C-DT	7e3f6a84-e2ec-458c-953e-bb83bd693ecc	pupil
25-8C-DT	46340dab-faa0-4f2d-8980-bf4c98d00c6c	pupil
25-8C-DT	0503adf6-4e05-4f0d-8802-660dcfbee96c	pupil
25-8C-DT	ece878d8-6e44-4f37-b38b-99dbd19f5518	pupil
25-8C-DT	81a9b148-9ff0-4678-8178-1fe37e8afe72	pupil
25-8C-DT	0c66c9e3-ad69-4a39-be10-59c48d04c65a	pupil
25-8C-DT	346d62db-eb7a-4c5e-b798-7dec26f75302	pupil
25-8C-DT	c4f2521e-86c2-43a6-a680-4f5b642c3dd7	pupil
25-8C-DT	24d1c27d-3365-4ceb-8909-c9c08444af9f	pupil
25-8C-DT	3bbc42b1-4ea6-48e3-84ad-6966551a3802	pupil
25-8C-DT	cbc7e991-08eb-4838-a10c-3ea2cb10e2d8	pupil
25-8C-DT	f69e0ef5-9d5b-41bf-857b-c78e20e75c1d	pupil
25-8C-DT	c0f570d7-9772-4a31-b5cd-d78e702f4dcb	pupil
25-8C-DT	964430f8-1194-4c00-a640-b795663c24e1	pupil
25-8C-DT	a0380237-abea-4988-84c7-c9d43179d2be	pupil
25-8C-DT	f6bdf187-d0bc-4c37-8034-202cfb4fb6db	pupil
25-8C-DT	969dbda5-2815-41e3-84bd-d14dd102eb39	pupil
25-8B-DT	6fd3433f-e468-4d21-b42b-36ea1ab60db7	pupil
25-8B-DT	e1ee44b9-0153-4d85-ab89-131b71189383	pupil
25-8B-DT	14b19cda-dd95-4ead-bf2e-9cb53d0c9524	pupil
25-8B-DT	cb62c43b-aca7-491a-949d-fb395e5ae1e2	pupil
25-8B-DT	221ad246-e0a0-4f41-9fce-a245b9a857f7	pupil
25-8B-DT	71fc12a2-b572-4853-869d-a31bbc71d7b7	pupil
25-8B-DT	25e0ec02-c0f2-4a5b-b705-49976155939d	pupil
25-8B-DT	8896700d-4f9e-466f-8b1b-f3d24de12076	pupil
25-8B-DT	9bfaa2e6-87ca-423c-af3a-b29b40f5f5db	pupil
25-8B-DT	d4b7fb1a-fc13-4878-ac15-2ac89009449a	pupil
25-8B-DT	e67e364e-6521-471f-afad-d1b2002733c7	pupil
25-8B-DT	299700ea-30c7-4da4-996b-59f1ad159a19	pupil
25-8B-DT	2ec08e87-597a-4c62-91f5-7611d54019f7	pupil
25-8B-DT	6c3bc1a2-792e-434e-9098-27065b69bacf	pupil
25-8B-DT	693e7720-4a1b-4379-993d-4a99b1ab4c15	pupil
25-8B-DT	dd25ed75-81f6-4275-b40a-78bb8c583b2a	pupil
25-8D-DT	2709f3c7-a488-467c-9c44-de36e1e9efda	pupil
25-8D-DT	a743e51a-3552-4915-8d77-edc57715a677	pupil
25-8D-DT	5a2b3e7a-2276-43b0-8bde-bec7677c3ed2	pupil
25-8D-DT	0a976181-0665-4c8b-a843-bb4b743de561	pupil
25-8D-DT	59e6f57c-7b4e-4c5c-85c2-ae95990e692a	pupil
25-8D-DT	baa7c664-9065-4cb9-9baa-69d385e7bcbe	pupil
25-8D-DT	e19a785b-0e0f-40b4-b839-c6ba381f5351	pupil
25-8D-DT	5e569c2b-17ee-4b5d-af58-820b9c9882df	pupil
25-8D-DT	c6502fb1-8970-456f-ab45-ff3ab0584dd3	pupil
25-8D-DT	1ceb90c6-1724-47a9-a8ee-b360a9640298	pupil
25-8D-DT	fc6f7281-baf1-4c72-81fe-b91e78dfc685	pupil
25-8D-DT	f4edc5de-aa0a-4cf1-8590-15275633126e	pupil
25-8D-DT	7ce65557-6f3b-4637-b771-b903f70ab024	pupil
25-8D-DT	6df706e1-deb4-4548-81cc-82d2fd481c05	pupil
25-8D-DT	a8bb99b2-5bf9-4b92-9e54-2c1843b7300b	pupil
25-8D-DT	b2b6227a-0371-48be-8a6a-1ca741597953	pupil
25-8D-DT	41be1008-67a4-4e15-95fb-36f5c333f13f	pupil
25-8D-DT	0624a38a-8a1a-45f7-93a7-cba3b6c78794	pupil
25-8D-DT	bb07d668-59ac-4ce9-a11f-64193b347cf4	pupil
25-9A-DT	35a5544d-1d93-4354-b4d1-fd74497b917f	pupil
25-9A-DT	6c39f828-ca07-4100-8415-0af0cf8d6e25	pupil
25-9A-DT	04638d3b-cf50-4724-a566-4fbd3e266de5	pupil
25-9A-DT	48da2f2e-545c-4ba3-9538-c018c81c757f	pupil
25-9A-DT	87256a00-fff4-47a4-b64c-c32b48b8f3c3	pupil
25-9A-DT	d63b381b-362f-4467-8127-258c736ae789	pupil
25-9A-DT	72764b6b-f518-4d9f-b044-beebaf5da7b6	pupil
25-9A-DT	8f719803-c401-44e4-bf15-f4a5121457c4	pupil
25-9A-DT	8aa0e2ec-19f2-423d-b8c4-697539e010a0	pupil
25-9A-DT	66b3ac3a-a491-4c2f-958c-d74151ec5618	pupil
25-9A-DT	50174a72-4c63-464e-bc8f-76d0cdb9caf0	pupil
25-9A-DT	aede0bdf-1c12-4a7b-a17b-aa619485ac96	pupil
25-9A-DT	27aea387-1140-456d-8094-5528755b8ebc	pupil
25-9A-DT	9ec0b86d-d060-4a2b-8841-5129ddc0ca27	pupil
25-9A-DT	9d9a3dfc-cf3e-4b12-acad-2ce5c4992fac	pupil
25-9A-DT	e7a2170f-64e0-4314-9175-7be5e99e5577	pupil
25-9A-DT	b81d8ba6-e7e8-4ab9-a13e-126e3458110b	pupil
25-9A-DT	3463a79d-c69a-4349-90d9-07b359099bf9	pupil
25-9A-DT	037f394f-e8b8-493f-aee8-9cf230b84a8d	pupil
25-9A-DT	7fe51a55-fa11-4763-b075-acbf88b2fba3	pupil
25-9A-DT	0f7f42d8-08c3-480e-ae49-fecd1f566e2a	pupil
25-9A-DT	d2023f55-f793-4f78-ac7c-2fcd4136917b	pupil
25-10-DT	6f41a8df-a416-4969-8c85-0d73b94b911a	pupil
25-10-DT	087cdeca-2026-4311-97ac-773a071ae72e	pupil
25-10-DT	a0e10f68-fd3f-47bf-af1b-e943e9112418	pupil
25-10-DT	dd9cacb2-477b-4f59-87fe-3fca05e403b8	pupil
25-10-DT	c2ce779b-b425-4a64-bc39-e4e4169efb97	pupil
25-10-DT	48e5bfbf-0f90-4da4-98ec-eca3e3c05942	pupil
25-10-DT	e061cf0c-7376-4b76-b144-191759658356	pupil
25-10-DT	9dc71764-db62-4488-be1c-592d88ec5d40	pupil
25-10-DT	47458c31-68f8-46ec-8746-f96e8573ed80	pupil
25-10-DT	d38d1069-803b-45c4-8e85-4dc03c0b57fe	pupil
25-10-DT	cf469225-6736-45e1-8653-81a487bef9fd	pupil
25-10-DT	3c25ee6f-5212-40ae-9bfe-11d7ddf72fad	pupil
25-10-DT	72a08bf8-2275-4d9d-896a-0b090e1feea0	pupil
25-10-DT	72280995-c969-4477-a0eb-859b58e3cc02	pupil
25-7A-IT	3352f5a2-3c8b-420e-90b7-d95ab6f1756c	pupil
25-7A-DT	43674f5f-609d-4eb4-bbd5-7702e25fd90c	pupil
25-7A-DT	0b06c019-3c79-41aa-ba0e-dcef11138971	pupil
25-7D-DT	a218e97a-df60-4ab9-a07f-bb111a90f688	pupil
25-7D-DT	43674f5f-609d-4eb4-bbd5-7702e25fd90c	pupil
25-7D-DT	655ba3ff-7e8b-48ef-af73-8f8ef09f50c1	pupil
25-7D-DT	0b06c019-3c79-41aa-ba0e-dcef11138971	pupil
25-7D-DT	19a04940-90c0-4f41-80a9-e33dd9e8f4c6	pupil
25-7D-DT	fb6d9eb9-bba1-4c1a-b68c-e6de19560409	pupil
25-7D-DT	a150e71f-5456-47c8-9cdc-354cb555375e	pupil
25-7D-DT	a9c83066-f970-4ed1-8f7d-639924433f2e	pupil
25-7D-DT	dd6b4b3a-6917-4bc0-9b58-074005f446ff	pupil
25-7D-DT	46014105-eb8d-411b-8fcd-78d49a5e38e7	pupil
25-7D-DT	86114b9a-15d9-47a0-a240-151032939580	pupil
25-7D-DT	d550fa4e-5da3-4a87-bf26-0ea8b4e24f29	pupil
25-7D-DT	e039f651-716f-4885-8d51-ed39a64510d3	pupil
25-7D-DT	4ff3ac98-71d2-412b-ac3c-faa3b08c4139	pupil
25-7D-DT	0de1d069-ccc6-448b-b769-ea622f308da4	pupil
25-7D-DT	3ed33ea2-5d8f-4048-a90d-99edcba045f0	pupil
25-7D-DT	08523f36-2ccd-4783-a959-6220539275a6	pupil
25-7D-DT	069c8bb7-12d5-4ecf-aaee-5705c8485232	pupil
25-7D-DT	de7319a5-4a01-4af6-bc48-8b26e81b2ecd	pupil
25-8A-DT	8f0329ce-c479-4707-aa73-8fcc06cb8b0e	pupil
25-8A-DT	199b1891-3db2-46cb-9fdf-e59f3f43a549	pupil
25-8A-DT	9343b61d-ddeb-4a03-a63b-4f86cdc99d8a	pupil
25-8A-DT	07669b35-d7e3-4da7-b025-a723307dc299	pupil
25-8A-DT	a201e5ab-b434-44b4-ad1a-629746f828a0	pupil
25-8A-DT	061b87c2-7d60-42df-a8ce-64b6bd0a51c0	pupil
25-8A-DT	123fa306-359e-49cf-ab4f-9d01fa0547e3	pupil
25-8A-DT	6c0e385b-63db-49c1-901c-045a0fab4c2e	pupil
25-8A-DT	decb53c4-8145-409e-920f-92529df8e1cb	pupil
25-8A-DT	46699a4b-e7ab-4d37-b1d3-9e7d0ea8578b	pupil
25-8A-DT	70a8b61a-29e6-490c-b817-1c12b5a852ea	pupil
25-8A-DT	6c0a43fc-b677-4e89-a3a6-8d5a987b91f7	pupil
25-8A-DT	cd922ea2-94e6-4c64-a4d3-d409dcddf89a	pupil
25-8A-DT	c74b5968-eb5d-4913-8c9a-c8d3e712caeb	pupil
25-8A-DT	45c783f1-06c2-410e-bdff-cff20d0f8f28	pupil
25-8A-DT	c3dcc007-c7b4-4b5f-9117-8f56735bc41d	pupil
25-8A-DT	3bb38960-cdf9-4f24-a0b3-fa3dfefa73f7	pupil
25-8A-DT	9a8864c2-cefe-4a6f-8430-61825ef54198	pupil
25-7B-DT	3c4257e4-2e66-42bf-930c-c0c9d4bb0e82	pupil
25-7B-DT	83c63f3e-7366-4858-9f9a-5a7713037638	pupil
25-7B-DT	444533bb-fe16-412d-940f-59a7aca92c15	pupil
25-7B-DT	81140397-32b3-4644-990e-59f640dffac7	pupil
25-7B-DT	918be17c-e235-478e-931e-0f1d19d74b45	pupil
25-7B-DT	f3339dc5-864c-4eae-a531-e2be9456134e	pupil
25-7B-DT	d31e3eba-418d-461c-a18f-2966e47b7396	pupil
25-7B-DT	0a7ac8b1-d098-47b8-859c-76287cdb317b	pupil
25-7B-DT	0a20f144-ba6c-4eba-99cf-0a796f236738	pupil
25-7B-DT	18afaf36-2649-4e4f-b21f-1b9c58e1a6ac	pupil
25-7B-DT	eb0001b7-4a89-4eef-9fb2-c9612fffe809	pupil
25-7B-DT	9c288a10-ca2d-4068-80d6-04bca9462151	pupil
25-7B-DT	f7afb571-80b2-4ddd-996c-c88a55e7ad97	pupil
25-7B-DT	4459487d-e00e-4ffb-ae6c-778a55eaba4c	pupil
25-7B-DT	973f80b1-aa45-4cf1-bc45-7db8d5d69a56	pupil
25-7B-DT	451acd3e-8a29-4ce9-a5b2-cf2f568a9f0b	pupil
25-7B-DT	f3650cd7-42ec-4a68-b6fb-64f56054e603	pupil
25-7B-DT	6bbc6a35-167e-436e-8e09-456b046ae1bf	pupil
25-7B-DT	37077463-85c3-4918-80b0-e6bf5ffac82c	pupil
25-7B-DT	e88f7c3a-95b8-4daa-acff-7d9f4714df01	pupil
25-7C-DT	cb49f6b3-3942-43ae-85a0-c046e619d9d6	pupil
25-7C-DT	255b0b13-9462-4f1c-b7f3-2c2da194e11c	pupil
25-7C-DT	56cec57f-298f-474e-9156-efd46b3d6e5b	pupil
25-7C-DT	296bc5d4-2316-44e4-b619-77b18ad8187a	pupil
25-7C-DT	12459f9a-f630-4aa3-8099-ac4d98bf0f13	pupil
25-7C-DT	5a4c5afb-183f-4384-a983-685a130044f4	pupil
25-7C-DT	dc7001ff-45c8-4e16-9475-38b2da804b87	pupil
25-7C-DT	3b3243b1-2a90-4ef7-8be9-2671053fa499	pupil
25-7C-DT	81ae3b82-97c3-412d-9081-79ab01bad4f7	pupil
25-7C-DT	664e7417-d6a6-4234-a294-1236e49ee813	pupil
25-7C-DT	724adbe5-ed2f-41d3-9c6d-c4b6ef713bef	pupil
25-7C-DT	78df1414-b07d-4bb1-a975-888976f0cec3	pupil
25-7C-DT	759de2b8-d6d6-4c15-9974-d2afc54fc49f	pupil
25-7C-DT	1bf70daa-7d8d-4a08-86bc-c60d1f639144	pupil
25-7C-DT	ce965175-ccbf-4472-9d6e-1f77125fbaef	pupil
25-7C-DT	10b3aadf-d1e6-4087-9338-be2904da256e	pupil
25-7C-DT	d6915c34-31b9-4225-9597-772452fc07bc	pupil
25-7C-DT	a21f4f66-871a-4119-b1b9-9cac07526fc2	pupil
25-7C-DT	0b7daafd-2fad-4638-8936-6004b4ba3575	pupil
25-7C-DT	bb22e5df-6b70-45bb-ada3-7e7a4f63984d	pupil
25-7A-DT	1f5cd3b2-9bc7-42d1-9610-6888fc2663d4	pupil
25-7A-DT	aa0c3979-03ee-4683-a11d-ed3bd265ac71	pupil
25-7A-DT	892cdae9-dc52-4696-88e8-f876f95cc305	pupil
25-7A-DT	81ede5d3-7f5b-43f2-be8d-56df25dddb62	pupil
25-7A-DT	607b28a9-f095-4e5f-8da0-fb92a9ed368f	pupil
25-7A-DT	1bc4f3e0-552b-4d1c-a1a8-809a1a30d982	pupil
25-7A-DT	a05e7fc3-20c5-4a0a-a26b-118e23c866c3	pupil
25-7A-DT	2dc65039-db93-46af-aeec-b0ac2ffa2a9c	pupil
25-7A-DT	a82b8d06-7513-45e5-bd0d-ecc09e81ec10	pupil
25-7A-DT	7ae4eb4c-c279-4fc1-8243-e4ca467914db	pupil
25-7A-DT	4284fdc3-83c4-46bf-b991-aa721c6265f8	pupil
25-7A-DT	3bba498c-145d-401e-9196-1f8c67ccf30e	pupil
25-7A-DT	720174a7-fd1c-443c-a9b4-70f0589328cf	pupil
25-7A-DT	5ddc5f8b-e70c-40ce-84b8-a03f58dec57d	pupil
25-7A-DT	a4962c40-be52-4b68-9795-ee5b8cfbd3e6	pupil
25-7A-DT	bcb8c5d1-ccb9-4c76-a728-c0af5aef3410	pupil
25-7A-DT	ffd45e59-2893-4f2b-90a2-4c20eb3e5eb9	pupil
25-7A-DT	6252da5f-5352-44c9-9fe3-5cf73fbf2bb3	pupil
25-7A-DT	58d719a3-c060-4a62-8032-5e0f96167a9c	pupil
25-7A-DT	c8f8ecc7-2257-40b7-9d44-21985375c591	pupil
25-8A-DT	77e7baed-219a-4eeb-8e85-3d06240c7a61	pupil
\.


--
-- Data for Name: learning_objectives; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."learning_objectives" ("learning_objective_id", "assessment_objective_id", "title", "order_index", "active") FROM stdin;
51f016ec-d795-4dae-bd45-e9b6d2731da6	bdde6eb2-c4c1-45cd-aca5-bc12f5cff3da	TBAT demonstrate the stages of the design process.	0	t
bae2ae66-9237-47b2-bbf0-2eee71ba2d27	30b7bd6c-a557-4742-8a86-305e73e51405	TBAT Draw Cubes and Cuboids in Isometric Style	0	t
4b12c990-0712-44d0-ac6d-c7aa20f4d9e0	628c4da2-9e81-4418-a09d-35ef15d60664	TBAT describe the functions, properties and applications of technical textiles	6	t
e9d2203e-2854-486f-a9bf-9dacb37d8035	30b7bd6c-a557-4742-8a86-305e73e51405	TBAT Construct Compound Shapes	1	t
c00e9974-47b9-47e8-a757-df111e41c9a6	0093f351-651b-4596-8ebf-2fb4ece3d69d	TBAT create, edit and fix 2D sketches.	0	t
ca58a8a2-dddd-4842-b799-3cb52bf5ae09	0093f351-651b-4596-8ebf-2fb4ece3d69d	TBAT use basic 3D Solid Modelling Tools to produce 3D models.	1	t
402ecb15-38a1-42a6-9dd8-41d074561230	068e78c6-f10f-415f-bd92-5911863de95d	New learning objective	0	t
974c9447-6828-46e0-aaae-d4be51365079	2d75e3d1-b9df-4a00-a98d-4125bf621c84	New learning objective	0	t
76db4bbb-e19d-4258-95b2-8b550ada9199	0adc9fbc-0e55-40a9-a171-724900002ae2	TBAT use the Computer Labs safely	0	t
f08a310a-707d-489e-a20b-8f3faf7531e8	0c718c20-dd56-4057-8303-d66e94f4876a	TBAT investigate history of a product from a range of sources.	0	t
ca2438ad-4506-4433-98ae-88ec599dcf50	bdde6eb2-c4c1-45cd-aca5-bc12f5cff3da	TBAT use cams, followers and rockers in designs.	1	t
f2b47b35-d92e-4b8c-93e7-993dabc78671	bdde6eb2-c4c1-45cd-aca5-bc12f5cff3da	TBAT demonstrate the rules of stability	2	t
98320bba-735e-4e8f-b074-b610d6b1976d	4a95a07c-f16e-4e00-af9c-1de772281ccd	TBAT Evaluate a final prototype.	0	t
6abc9de2-6289-4731-8841-4cecdbe03f5b	0c718c20-dd56-4057-8303-d66e94f4876a	TBAT discover sources to be used as inspiration.	1	t
d8b43f44-13ae-4bb6-bd13-ae8bbfd9529a	51008e73-7d49-406c-82ce-a47574ab0466	TBAT investigate history of a product from a range of sources.	0	t
1b665101-99a1-458e-8ee5-4bc469be79e3	0c718c20-dd56-4057-8303-d66e94f4876a	TBAT create a design specification	2	t
d8ee63c3-275a-4fc7-8249-732a1511968e	3553266c-30e4-4d62-8d50-8df7c4405e5f	New learning objective	0	t
68b6deef-b853-4216-81c8-67b97f5957fe	628c4da2-9e81-4418-a09d-35ef15d60664	1.3.1 TBAT describe how different energy sources are generated and stored.	0	t
9d52d0ef-cbb7-4a4e-91da-1a4c777906ba	51008e73-7d49-406c-82ce-a47574ab0466	TBAT discover sources to be used as inspiration.	1	t
071a529f-ece6-4c63-8880-ee7e3adbec2d	628c4da2-9e81-4418-a09d-35ef15d60664	TBAT evaluate factors that influence the choice of energy source for a product or system.	2	t
00197581-b55c-4569-aa1a-f7e627519d4a	628c4da2-9e81-4418-a09d-35ef15d60664	1.3.2 TBAT explain how different systems are powered using various energy sources.	1	t
4f5ee621-f38c-4086-b81a-9b1321e0fc26	628c4da2-9e81-4418-a09d-35ef15d60664	1.1 TBAT explain how new and emerging technologies impact industry, enterprise, sustainability, people, culture, society, the environment, and production systems.	3	t
4da307cc-d611-4088-a03a-0624faa6b19c	628c4da2-9e81-4418-a09d-35ef15d60664	TBAT describe the properties and applications of smart materials	4	t
be57b13f-0670-4a5d-965b-81ac7d96db10	628c4da2-9e81-4418-a09d-35ef15d60664	TBAT describe the composition, properties and uses of composites	5	t
2cc51b3c-b059-4685-b0a6-c80944cc755e	51008e73-7d49-406c-82ce-a47574ab0466	TBAT create a design specification	2	t
56f2c728-984e-4e3f-ae0b-93e505c555dc	5e7c520a-8fae-4335-a038-8a13836440b7	TBAT use cams, followers and rockers in designs.	0	t
324d1083-0008-42e3-98d4-022a2e9c5575	40dfd5c1-b40d-434c-a2b9-be5b46b0806e	TBAT investigate history of a product from a range of sources.	0	t
002fb840-bcb2-4e0b-8648-936c8a94197e	40dfd5c1-b40d-434c-a2b9-be5b46b0806e	TBAT discover sources to be used as inspiration.	1	t
45f38eb2-6d6c-4709-bbcc-ea98fa6bb981	40dfd5c1-b40d-434c-a2b9-be5b46b0806e	TBAT create a design specification	2	t
e0cfb5b3-cbac-44e2-9f18-b053f5885525	70eff390-4af4-4468-98dd-b9c72a921da8	TBAT use cams, followers and rockers in designs.	0	t
5572f4d9-1904-4a79-a462-684677c1c950	30b7bd6c-a557-4742-8a86-305e73e51405	TBAT Construct Isometric 3D shapes	2	t
c0f41566-4a8d-411f-9590-c6d12389d62c	30b7bd6c-a557-4742-8a86-305e73e51405	TBAT Construct Organic isometric shapes.	3	t
79fa10e0-9e6a-4665-b62a-6a6877ca0b67	30b7bd6c-a557-4742-8a86-305e73e51405	TBAT Generate a set of Initial Designs.	4	t
e08c9f58-4420-4aed-9fdb-f16efaa398b5	1e48e7ad-3bc4-4cdf-9499-8fe43eeb362a	Identify different types of digital devices.	0	t
c75ce05e-0b46-4b3d-8150-5ab27bba2cb9	1e48e7ad-3bc4-4cdf-9499-8fe43eeb362a	Explain how different devices are used in everyday life.	1	t
762b48f7-0357-4935-b70c-8e4d289cfeb7	1e48e7ad-3bc4-4cdf-9499-8fe43eeb362a	Understand multifunctional and converging technologies.	2	t
58f3ebe0-eaa3-48e7-941f-48ce961ede46	30b7bd6c-a557-4742-8a86-305e73e51405	TBAT create a prototype of a design.	5	t
2d567e35-cfd0-4a00-8f9b-7dd8522f313a	796657b2-5194-4791-9a57-30913527ff55	TBAT Produce 2D CAD Sketches	0	t
9abe4247-d57b-4fcb-a067-165efeaf4849	796657b2-5194-4791-9a57-30913527ff55	TBAT Produce Simple 3D Models.	1	t
2e1102cf-e28c-4983-8c0e-c51875e55026	8cc414a8-97b2-4c86-8c9b-59281de29e06	New learning objective	0	f
63f8d18c-c47b-4217-8e6b-0e18644dcd6b	30b7bd6c-a557-4742-8a86-305e73e51405	TBAT create sketches to DT Standard	6	t
852f8779-6a5e-4fff-9f53-6cba0dc138f3	0ef6384a-70f8-4870-8fdb-9515226feb8d	New learning objective	0	f
5503e8d3-e6b0-4bd3-9459-ee526a334cbb	0093f351-651b-4596-8ebf-2fb4ece3d69d	TBAT use custom scripts to produce complex models.	2	t
\.


--
-- Data for Name: lesson_assignments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."lesson_assignments" ("group_id", "lesson_id", "start_date") FROM stdin;
25-7C-DT	ca8445e2-364b-410d-922f-57c1c2f9bf44	2025-09-21
25-7D-DT	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	2025-09-28
25-7D-DT	a2aa2eb2-c7e4-4359-9801-fb2c8680584d	2025-10-05
25-7D-DT	a1cad678-35ea-4a5b-b799-12ac2eb7c51f	2025-10-12
25-8B-DT	57f6e550-c3a0-40ab-a655-b04d9d957b43	2025-11-02
25-8B-DT	a4b64a59-c06d-46af-ba54-d225fe038340	2025-11-09
25-8B-DT	0fb3433e-c64c-425f-b1e3-02d3eac7336c	2025-11-16
25-8B-DT	726e9467-3e08-4e30-b06c-ac603a576e3d	2025-11-23
25-7A-IT	33c2b85f-3ce2-4f21-b21b-377cf20b2a21	2025-09-21
25-7D-DT	ca8445e2-364b-410d-922f-57c1c2f9bf44	2025-09-21
25-7D-DT	5b4f0a5e-d001-443d-a141-1605d5f5d831	2025-09-28
25-10-DT	a95b9992-5eab-4720-850c-164062a036a5	2025-10-19
25-7B-DT	ca8445e2-364b-410d-922f-57c1c2f9bf44	2025-09-21
25-11-DT	ca8445e2-364b-410d-922f-57c1c2f9bf44	2025-09-21
25-11-DT	5b4f0a5e-d001-443d-a141-1605d5f5d831	2025-09-28
25-11-DT	0a8d6d77-4479-4998-9a41-98e674ead134	2025-10-05
25-7A-DT	a1cad678-35ea-4a5b-b799-12ac2eb7c51f	2025-10-12
25-7A-DT	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	2025-09-28
25-8B-DT	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	2025-09-21
25-8B-DT	79315679-c71e-4998-a121-3464829aaff1	2025-09-28
25-8B-DT	bb677055-41fb-4522-839e-741bd4376f85	2025-10-05
25-8B-DT	07bf233b-a07f-426b-948d-486cbb43b204	2025-10-12
25-10-DT	db7a9daa-f08a-4776-b60e-21cb06a25333	2025-09-14
25-10-DT	8265e3e2-cd36-49dd-ba4f-66e6a95cdef5	2025-09-21
25-8B-DT	ba6232e8-d343-4583-9f6a-3cf3c8602de2	2025-10-19
25-7A-IT	0c60fa60-a7ed-47f5-822e-94b3a02dc3a2	2025-09-21
25-7A-IT	cedd9f2e-34c0-46ed-88a5-a3fdfd9fc7cf	2025-09-14
25-9A-DT	a433c9cb-aee5-4280-9b25-62a43ae4a53e	2025-09-21
25-9B-DT	a433c9cb-aee5-4280-9b25-62a43ae4a53e	2025-09-21
25-9C-DT	a433c9cb-aee5-4280-9b25-62a43ae4a53e	2025-09-21
25-9D-DT	a433c9cb-aee5-4280-9b25-62a43ae4a53e	2025-09-21
25-9A-DT	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2025-09-28
25-9B-DT	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2025-09-28
25-9C-DT	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2025-09-28
25-9D-DT	9d3dd129-0a25-4f9e-a793-7a6edb45518e	2025-09-28
25-8A-DT	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	2025-09-21
25-8C-DT	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	2025-09-21
25-8D-DT	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	2025-09-21
25-10-DT	894d0db3-8267-419c-b809-7d602f4837ae	2025-09-21
25-10-DT	85bf23e8-0031-46dc-948e-cb5c6a9143d4	2025-09-21
25-10-DT	60dcabc1-89b4-4e0c-a3cc-db96a05caca5	2025-09-14
25-10-DT	8ba04ee3-0983-470d-9524-a32584f4820e	2025-09-21
25-10-DT	7b7d9425-e54b-4fa9-95ac-dc71b7ec46c3	2025-09-28
25-10-DT	26d09acd-24fd-40d5-b631-457ae13dded3	2025-10-05
25-8C-DT	79315679-c71e-4998-a121-3464829aaff1	2025-09-28
25-8C-DT	bb677055-41fb-4522-839e-741bd4376f85	2025-10-05
25-8A-DT	79315679-c71e-4998-a121-3464829aaff1	2025-09-28
25-8A-DT	bb677055-41fb-4522-839e-741bd4376f85	2025-10-05
25-8D-DT	79315679-c71e-4998-a121-3464829aaff1	2025-09-28
25-8D-DT	bb677055-41fb-4522-839e-741bd4376f85	2025-10-05
25-10-DT	abccd308-abc1-4433-ac35-207d0c2a3dbc	2025-10-12
25-10-DT	84ef0aee-3207-49fa-8049-49ce868d2b61	2025-10-19
25-10-DT	42dbd5b1-162c-4c27-9547-79eb39b34b4d	2025-10-19
25-10-DT	645bd8e1-2b8d-45a8-b7b3-30def0008dd1	2025-10-26
25-10-DT	20404875-be5c-42c9-9023-ed4539b45f1c	2025-10-05
25-8A-DT	8d96130b-2336-46a1-a214-73ec4e7e980d	2025-09-14
25-8B-DT	8d96130b-2336-46a1-a214-73ec4e7e980d	2025-09-14
25-8D-DT	8d96130b-2336-46a1-a214-73ec4e7e980d	2025-09-14
25-9A-DT	4c6ae118-4296-4830-a82a-aba00760e314	2025-10-05
25-9A-DT	47cbfb42-2e8d-4ee7-ac0e-b732f95ab8c1	2025-10-12
25-9A-DT	76ed126c-cbca-45a3-aaba-ed2ac326c1bd	2025-10-19
25-9A-DT	7ca3caa4-c8b2-4ed4-82e3-51bc15439466	2025-10-26
25-9A-DT	0b4d75e6-162d-4513-aca7-4ed842aa2f8d	2025-11-02
25-9A-DT	bdd6500e-cdfa-475e-9f33-496b5daf98b9	2025-11-09
25-9A-DT	96f9a9a3-20ad-4166-8368-33919a235436	2025-11-16
25-9A-DT	0556b2f1-06f2-4270-b3bb-1e37779145a5	2025-11-23
25-11-DT	85bf23e8-0031-46dc-948e-cb5c6a9143d4	2025-10-12
25-9B-DT	4c6ae118-4296-4830-a82a-aba00760e314	2025-10-05
25-11-DT	7b7d9425-e54b-4fa9-95ac-dc71b7ec46c3	2025-09-28
25-11-DT	a95b9992-5eab-4720-850c-164062a036a5	2025-09-28
25-11-DT	84ef0aee-3207-49fa-8049-49ce868d2b61	2025-09-28
25-11-DT	42dbd5b1-162c-4c27-9547-79eb39b34b4d	2025-09-21
25-9B-DT	47cbfb42-2e8d-4ee7-ac0e-b732f95ab8c1	2025-10-12
25-11-DT	645bd8e1-2b8d-45a8-b7b3-30def0008dd1	2025-10-12
25-9B-DT	76ed126c-cbca-45a3-aaba-ed2ac326c1bd	2025-10-19
25-9B-DT	7ca3caa4-c8b2-4ed4-82e3-51bc15439466	2025-10-26
25-9B-DT	0b4d75e6-162d-4513-aca7-4ed842aa2f8d	2025-11-02
25-9B-DT	bdd6500e-cdfa-475e-9f33-496b5daf98b9	2025-11-09
25-9B-DT	96f9a9a3-20ad-4166-8368-33919a235436	2025-11-16
25-9B-DT	0556b2f1-06f2-4270-b3bb-1e37779145a5	2025-11-23
25-7C-DT	5b4f0a5e-d001-443d-a141-1605d5f5d831	2025-09-28
25-7A-DT	8d96130b-2336-46a1-a214-73ec4e7e980d	2025-09-07
25-7B-DT	8d96130b-2336-46a1-a214-73ec4e7e980d	2025-09-07
25-7C-DT	8d96130b-2336-46a1-a214-73ec4e7e980d	2025-09-07
25-7D-DT	8d96130b-2336-46a1-a214-73ec4e7e980d	2025-09-07
25-7A-DT	ca8445e2-364b-410d-922f-57c1c2f9bf44	2025-09-14
25-7A-DT	a2aa2eb2-c7e4-4359-9801-fb2c8680584d	2025-10-05
25-7A-DT	69da46b7-19db-47e0-93db-5b6fd95eef5e	2025-10-26
25-7A-DT	5b4f0a5e-d001-443d-a141-1605d5f5d831	2025-09-21
25-7B-DT	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	2025-09-28
25-7C-DT	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	2025-09-28
25-9C-DT	4c6ae118-4296-4830-a82a-aba00760e314	2025-10-05
25-9D-DT	0b4d75e6-162d-4513-aca7-4ed842aa2f8d	2025-11-02
25-7A-IT	b576b985-26c9-4f86-a465-b683d657f5d7	2025-09-28
25-9C-DT	47cbfb42-2e8d-4ee7-ac0e-b732f95ab8c1	2025-10-12
25-9D-DT	bdd6500e-cdfa-475e-9f33-496b5daf98b9	2025-11-09
25-7B-IT	33c2b85f-3ce2-4f21-b21b-377cf20b2a21	2025-09-21
25-7C-IT	33c2b85f-3ce2-4f21-b21b-377cf20b2a21	2025-09-21
25-7D-IT	33c2b85f-3ce2-4f21-b21b-377cf20b2a21	2025-09-21
25-9C-DT	76ed126c-cbca-45a3-aaba-ed2ac326c1bd	2025-10-19
25-9D-DT	96f9a9a3-20ad-4166-8368-33919a235436	2025-11-16
25-7B-IT	b576b985-26c9-4f86-a465-b683d657f5d7	2025-09-28
25-7C-IT	b576b985-26c9-4f86-a465-b683d657f5d7	2025-09-28
25-7D-IT	b576b985-26c9-4f86-a465-b683d657f5d7	2025-09-28
25-9C-DT	7ca3caa4-c8b2-4ed4-82e3-51bc15439466	2025-10-26
25-9D-DT	0556b2f1-06f2-4270-b3bb-1e37779145a5	2025-11-23
25-9A-DT	dd003478-e764-48a6-b3c5-29449b365cec	2025-09-07
25-9A-DT	9e810b7a-7a64-4adf-9d10-c60550273b49	2025-09-14
25-9B-DT	dd003478-e764-48a6-b3c5-29449b365cec	2025-09-07
25-9B-DT	9e810b7a-7a64-4adf-9d10-c60550273b49	2025-09-14
25-9C-DT	dd003478-e764-48a6-b3c5-29449b365cec	2025-09-07
25-9C-DT	9e810b7a-7a64-4adf-9d10-c60550273b49	2025-09-14
25-9D-DT	dd003478-e764-48a6-b3c5-29449b365cec	2025-09-07
25-9D-DT	9e810b7a-7a64-4adf-9d10-c60550273b49	2025-09-14
25-9C-DT	0b4d75e6-162d-4513-aca7-4ed842aa2f8d	2025-11-02
25-10-DT	0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	2025-10-19
25-9C-DT	bdd6500e-cdfa-475e-9f33-496b5daf98b9	2025-11-09
25-9C-DT	96f9a9a3-20ad-4166-8368-33919a235436	2025-11-16
25-9C-DT	0556b2f1-06f2-4270-b3bb-1e37779145a5	2025-11-23
25-9D-DT	4c6ae118-4296-4830-a82a-aba00760e314	2025-10-05
25-9D-DT	47cbfb42-2e8d-4ee7-ac0e-b732f95ab8c1	2025-10-12
25-9D-DT	76ed126c-cbca-45a3-aaba-ed2ac326c1bd	2025-10-19
25-9D-DT	7ca3caa4-c8b2-4ed4-82e3-51bc15439466	2025-10-26
25-7C-DT	a2aa2eb2-c7e4-4359-9801-fb2c8680584d	2025-10-05
25-8A-DT	57f6e550-c3a0-40ab-a655-b04d9d957b43	2025-11-02
25-8D-DT	57f6e550-c3a0-40ab-a655-b04d9d957b43	2025-11-02
25-7B-DT	5b4f0a5e-d001-443d-a141-1605d5f5d831	2025-09-28
25-8A-DT	a4b64a59-c06d-46af-ba54-d225fe038340	2025-11-09
25-8A-DT	0fb3433e-c64c-425f-b1e3-02d3eac7336c	2025-11-16
25-8A-DT	726e9467-3e08-4e30-b06c-ac603a576e3d	2025-11-23
25-7B-DT	69da46b7-19db-47e0-93db-5b6fd95eef5e	2025-11-02
25-8D-DT	a4b64a59-c06d-46af-ba54-d225fe038340	2025-11-09
25-8D-DT	0fb3433e-c64c-425f-b1e3-02d3eac7336c	2025-11-16
25-7C-DT	69da46b7-19db-47e0-93db-5b6fd95eef5e	2025-11-02
25-8D-DT	726e9467-3e08-4e30-b06c-ac603a576e3d	2025-11-23
25-8C-DT	57f6e550-c3a0-40ab-a655-b04d9d957b43	2025-11-02
25-8C-DT	a4b64a59-c06d-46af-ba54-d225fe038340	2025-11-09
25-8A-DT	07bf233b-a07f-426b-948d-486cbb43b204	2025-10-12
25-8A-DT	ba6232e8-d343-4583-9f6a-3cf3c8602de2	2025-10-19
25-8D-DT	07bf233b-a07f-426b-948d-486cbb43b204	2025-10-12
25-8D-DT	ba6232e8-d343-4583-9f6a-3cf3c8602de2	2025-10-19
25-8C-DT	07bf233b-a07f-426b-948d-486cbb43b204	2025-10-12
25-8C-DT	ba6232e8-d343-4583-9f6a-3cf3c8602de2	2025-10-19
25-7B-DT	a1cad678-35ea-4a5b-b799-12ac2eb7c51f	2025-10-12
25-7B-DT	a2aa2eb2-c7e4-4359-9801-fb2c8680584d	2025-10-05
25-8C-DT	0fb3433e-c64c-425f-b1e3-02d3eac7336c	2025-11-16
25-7C-DT	a1cad678-35ea-4a5b-b799-12ac2eb7c51f	2025-10-12
25-8C-DT	726e9467-3e08-4e30-b06c-ac603a576e3d	2025-11-23
\.


--
-- Data for Name: lesson_links; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."lesson_links" ("lesson_link_id", "lesson_id", "url", "description") FROM stdin;
15761418-02a7-42f8-803b-929262cb4275	ca8445e2-364b-410d-922f-57c1c2f9bf44	https://bisak-my.sharepoint.com/:p:/g/personal/sleroy_bisak_org/EV7wLki4OT5Orn_Aht7cpd0B2e2FehIWV9j9VVWEE_f93g?e=xDqJgl	Existing Designers
9e356ecc-2802-4a57-86d0-44de2df6c421	85bf23e8-0031-46dc-948e-cb5c6a9143d4	https://app.formative.com/formatives/68d4043de0310953d26cc32e	Assessment Formative
\.


--
-- Data for Name: lesson_success_criteria; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."lesson_success_criteria" ("lesson_id", "success_criteria_id") FROM stdin;
33c2b85f-3ce2-4f21-b21b-377cf20b2a21	32c9e025-e8ad-4d50-b25c-c59d2524b0cd
b576b985-26c9-4f86-a465-b683d657f5d7	32c9e025-e8ad-4d50-b25c-c59d2524b0cd
33c2b85f-3ce2-4f21-b21b-377cf20b2a21	6bfdf9bd-d381-4313-b4b3-d0c6d1968a48
b576b985-26c9-4f86-a465-b683d657f5d7	6bfdf9bd-d381-4313-b4b3-d0c6d1968a48
a1cad678-35ea-4a5b-b799-12ac2eb7c51f	f53315cb-f3b0-4328-8133-1f2c91f91bfe
cedd9f2e-34c0-46ed-88a5-a3fdfd9fc7cf	fa9fc3d7-d789-4aef-b4d9-afc48fa628e3
0c60fa60-a7ed-47f5-822e-94b3a02dc3a2	32c9e025-e8ad-4d50-b25c-c59d2524b0cd
0c60fa60-a7ed-47f5-822e-94b3a02dc3a2	6bfdf9bd-d381-4313-b4b3-d0c6d1968a48
dd003478-e764-48a6-b3c5-29449b365cec	54b4e504-7bd3-4133-8d20-39b1ee29181d
dd003478-e764-48a6-b3c5-29449b365cec	5f2b7707-db53-4b6f-9890-fa65f9154e6d
9e810b7a-7a64-4adf-9d10-c60550273b49	54b4e504-7bd3-4133-8d20-39b1ee29181d
9e810b7a-7a64-4adf-9d10-c60550273b49	5f2b7707-db53-4b6f-9890-fa65f9154e6d
a1cad678-35ea-4a5b-b799-12ac2eb7c51f	37fccff6-414c-463c-8d20-68489df1e0f3
a1cad678-35ea-4a5b-b799-12ac2eb7c51f	b59cca57-9e74-4a95-ad37-5db8c3383ebc
a1cad678-35ea-4a5b-b799-12ac2eb7c51f	c6027ce2-2cb1-427e-8130-81ed9fac5d93
8d96130b-2336-46a1-a214-73ec4e7e980d	f53315cb-f3b0-4328-8133-1f2c91f91bfe
8d96130b-2336-46a1-a214-73ec4e7e980d	37fccff6-414c-463c-8d20-68489df1e0f3
8d96130b-2336-46a1-a214-73ec4e7e980d	be239da2-aad5-4b97-951c-2ef1548752c1
8d96130b-2336-46a1-a214-73ec4e7e980d	b59cca57-9e74-4a95-ad37-5db8c3383ebc
8d96130b-2336-46a1-a214-73ec4e7e980d	c6027ce2-2cb1-427e-8130-81ed9fac5d93
bb677055-41fb-4522-839e-741bd4376f85	279542cb-7139-467a-9cc3-0dda362fe8aa
bb677055-41fb-4522-839e-741bd4376f85	37864689-b68e-4958-810e-0492af84cec9
a1cad678-35ea-4a5b-b799-12ac2eb7c51f	e02cecb6-8178-4a08-8698-432a566f922d
a1cad678-35ea-4a5b-b799-12ac2eb7c51f	9975d1de-864a-4175-861b-ffa70938efbd
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	4012d28f-87b1-4fe6-9156-66e144dc717e
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	5a684b30-147c-4072-9a12-848f4d751fd9
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	61b92e1a-896e-4c1a-b453-5e706d679350
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	040ee0f2-9508-42ea-980f-77b63f8d1d59
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	9b799694-4e34-40c8-8860-c327825864d9
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	9a0f7cd1-75b5-4979-91d3-3b4d2a53d001
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	d871a50a-fea8-4ee9-bd85-eeedeac32e38
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	581aa31f-1c68-4599-9bfd-268185ec46ee
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	7de602d1-30dd-481f-84c2-a427345db200
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	2e92cb9a-55be-40f1-bede-76e16e008711
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	e6434c7d-7d8d-42dd-99ff-57980bd7a8fd
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	bd0c1b0e-26d4-4447-8dde-2d068014ba50
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	0c161717-84a3-488b-9588-0cd19418fd0a
0514a6e3-8fcf-4ee0-8b44-5ae6809fc6ed	f6838e26-11b8-4918-9eec-3f880078d6a6
\.


--
-- Data for Name: lessons_learning_objective; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."lessons_learning_objective" ("learning_objective_id", "lesson_id", "order_index", "title", "active", "order_by") FROM stdin;
51f016ec-d795-4dae-bd45-e9b6d2731da6	879a4c7f-9a62-41d5-ac4f-5d8dbfc59d94	0	DT Induction to KS4	t	0
c0f41566-4a8d-411f-9590-c6d12389d62c	a2aa2eb2-c7e4-4359-9801-fb2c8680584d	0	4 – Circles, Curves and Ellipses	t	0
c0f41566-4a8d-411f-9590-c6d12389d62c	4c13b48b-3af1-48cc-952e-428097c13686	0	5 – Details (Chamfers, Fillets, Holes and Ridges)	t	0
bae2ae66-9237-47b2-bbf0-2eee71ba2d27	0a8d6d77-4479-4998-9a41-98e674ead134	0	Practice Lesson	t	0
5572f4d9-1904-4a79-a462-684677c1c950	fb2eb631-0dda-4b84-b5b2-5c5d7afeae2e	0	3 – Solids: Prisms and Pyramids	t	0
e9d2203e-2854-486f-a9bf-9dacb37d8035	5b4f0a5e-d001-443d-a141-1605d5f5d831	0	2 – Adding and Subtracting Shapes	t	0
58f3ebe0-eaa3-48e7-941f-48ce961ede46	47cbfb42-2e8d-4ee7-ac0e-b732f95ab8c1	0	Des: Flat Prototype	t	0
76db4bbb-e19d-4258-95b2-8b550ada9199	cedd9f2e-34c0-46ed-88a5-a3fdfd9fc7cf	0	Induction 1	t	0
76db4bbb-e19d-4258-95b2-8b550ada9199	0c60fa60-a7ed-47f5-822e-94b3a02dc3a2	0	Induction 2	t	0
4da307cc-d611-4088-a03a-0624faa6b19c	a95b9992-5eab-4720-850c-164062a036a5	0	Smart Materials	t	0
bae2ae66-9237-47b2-bbf0-2eee71ba2d27	ca8445e2-364b-410d-922f-57c1c2f9bf44	0	1 – Cubes and Cuboids	t	0
ca2438ad-4506-4433-98ae-88ec599dcf50	9d3dd129-0a25-4f9e-a793-7a6edb45518e	0	Investigate Cams, Followers and Rockers	t	0
68b6deef-b853-4216-81c8-67b97f5957fe	85bf23e8-0031-46dc-948e-cb5c6a9143d4	0	Energy Generation Assessment	t	0
00197581-b55c-4569-aa1a-f7e627519d4a	85bf23e8-0031-46dc-948e-cb5c6a9143d4	0	Energy Generation Assessment	t	1
071a529f-ece6-4c63-8880-ee7e3adbec2d	85bf23e8-0031-46dc-948e-cb5c6a9143d4	0	Energy Generation Assessment	t	2
68b6deef-b853-4216-81c8-67b97f5957fe	60dcabc1-89b4-4e0c-a3cc-db96a05caca5	0	Energy Generation and Comparison	t	0
00197581-b55c-4569-aa1a-f7e627519d4a	60dcabc1-89b4-4e0c-a3cc-db96a05caca5	0	Energy Generation and Comparison	t	1
071a529f-ece6-4c63-8880-ee7e3adbec2d	60dcabc1-89b4-4e0c-a3cc-db96a05caca5	0	Energy Generation and Comparison	t	2
be57b13f-0670-4a5d-965b-81ac7d96db10	84ef0aee-3207-49fa-8049-49ce868d2b61	0	Composite Matererials	t	0
4f5ee621-f38c-4086-b81a-9b1321e0fc26	8ba04ee3-0983-470d-9524-a32584f4820e	0	Emerging Technologies	t	0
4b12c990-0712-44d0-ac6d-c7aa20f4d9e0	42dbd5b1-162c-4c27-9547-79eb39b34b4d	0	Technical Textiles	t	0
4f5ee621-f38c-4086-b81a-9b1321e0fc26	7b7d9425-e54b-4fa9-95ac-dc71b7ec46c3	0	Emerging Technology	t	0
4f5ee621-f38c-4086-b81a-9b1321e0fc26	26d09acd-24fd-40d5-b631-457ae13dded3	0	Emerging Technology Assessment	t	0
4da307cc-d611-4088-a03a-0624faa6b19c	abccd308-abc1-4433-ac35-207d0c2a3dbc	0	Smart & Composite materials and technical textiles.	t	0
be57b13f-0670-4a5d-965b-81ac7d96db10	abccd308-abc1-4433-ac35-207d0c2a3dbc	0	Smart & Composite materials and technical textiles.	t	1
4b12c990-0712-44d0-ac6d-c7aa20f4d9e0	abccd308-abc1-4433-ac35-207d0c2a3dbc	0	Smart & Composite materials and technical textiles - Overview.	t	2
4da307cc-d611-4088-a03a-0624faa6b19c	645bd8e1-2b8d-45a8-b7b3-30def0008dd1	0	SCT - Assessment	t	0
be57b13f-0670-4a5d-965b-81ac7d96db10	645bd8e1-2b8d-45a8-b7b3-30def0008dd1	0	SCT - Assessment	t	1
4b12c990-0712-44d0-ac6d-c7aa20f4d9e0	645bd8e1-2b8d-45a8-b7b3-30def0008dd1	0	SCT - Assessment	t	2
c0f41566-4a8d-411f-9590-c6d12389d62c	69da46b7-19db-47e0-93db-5b6fd95eef5e	0	Challenge: Draw a Toy Plane	t	0
5572f4d9-1904-4a79-a462-684677c1c950	69da46b7-19db-47e0-93db-5b6fd95eef5e	0	Challenge: Draw a Toy Plane	t	1
e9d2203e-2854-486f-a9bf-9dacb37d8035	69da46b7-19db-47e0-93db-5b6fd95eef5e	0	Challenge: Draw a Toy Plane	t	2
bae2ae66-9237-47b2-bbf0-2eee71ba2d27	69da46b7-19db-47e0-93db-5b6fd95eef5e	0	Challenge: Draw a Toy Plane	t	3
1b665101-99a1-458e-8ee5-4bc469be79e3	65871063-5469-4da7-bf88-dc3af13a522c	0	Writing a Design Specification	t	0
f2b47b35-d92e-4b8c-93e7-993dabc78671	513d5ef7-b6a4-4c2c-b5c1-3cca7aef38cc	0	Structures in Design: Slots, Tabs & Stability	t	0
6abc9de2-6289-4731-8841-4cecdbe03f5b	79315679-c71e-4998-a121-3464829aaff1	0	Investogating existing designs	t	0
1b665101-99a1-458e-8ee5-4bc469be79e3	bb677055-41fb-4522-839e-741bd4376f85	0	Write a simple Design Specification	t	0
79fa10e0-9e6a-4665-b62a-6a6877ca0b67	07bf233b-a07f-426b-948d-486cbb43b204	0	Des: Ideation - Initial Ideas	t	0
79fa10e0-9e6a-4665-b62a-6a6877ca0b67	4c6ae118-4296-4830-a82a-aba00760e314	0	Des:Initial Designs	t	0
e08c9f58-4420-4aed-9fdb-f16efaa398b5	92a3d29d-8cb4-464f-8f67-83c7f8f4aba3	0	Lesson 1 - Types of Digital Device	t	0
c75ce05e-0b46-4b3d-8150-5ab27bba2cb9	92a3d29d-8cb4-464f-8f67-83c7f8f4aba3	0	Lesson 1 - Types of Digital Device	t	1
51f016ec-d795-4dae-bd45-e9b6d2731da6	8d96130b-2336-46a1-a214-73ec4e7e980d	0	DT Induction Lesson	t	0
f08a310a-707d-489e-a20b-8f3faf7531e8	a433c9cb-aee5-4280-9b25-62a43ae4a53e	0	Investigate History	t	0
51f016ec-d795-4dae-bd45-e9b6d2731da6	a433c9cb-aee5-4280-9b25-62a43ae4a53e	0	Investigate History	t	1
ca2438ad-4506-4433-98ae-88ec599dcf50	0b4d75e6-162d-4513-aca7-4ed842aa2f8d	0	Make:	t	0
2d567e35-cfd0-4a00-8f9b-7dd8522f313a	db7a9daa-f08a-4776-b60e-21cb06a25333	0	Onshape Introduction	t	0
2d567e35-cfd0-4a00-8f9b-7dd8522f313a	8265e3e2-cd36-49dd-ba4f-66e6a95cdef5	0	OnShape 2D Basic Sketches	t	0
9abe4247-d57b-4fcb-a067-165efeaf4849	894d0db3-8267-419c-b809-7d602f4837ae	0	OnShape Extrusions	t	0
9abe4247-d57b-4fcb-a067-165efeaf4849	8115af17-90c5-4e35-aa58-722afd856ace	0	OnShape Extrustions - Ex 1	t	0
9abe4247-d57b-4fcb-a067-165efeaf4849	467a1b3c-20a4-4960-8d2e-7b163c0821d4	0	OnShape Variables	t	0
9abe4247-d57b-4fcb-a067-165efeaf4849	20404875-be5c-42c9-9023-ed4539b45f1c	0	Make a Box	t	0
bae2ae66-9237-47b2-bbf0-2eee71ba2d27	a1cad678-35ea-4a5b-b799-12ac2eb7c51f	0	6-Assessment	t	0
e9d2203e-2854-486f-a9bf-9dacb37d8035	a1cad678-35ea-4a5b-b799-12ac2eb7c51f	0	6-Assessment	t	1
5572f4d9-1904-4a79-a462-684677c1c950	a1cad678-35ea-4a5b-b799-12ac2eb7c51f	0	6-Assessment	t	2
c0f41566-4a8d-411f-9590-c6d12389d62c	a1cad678-35ea-4a5b-b799-12ac2eb7c51f	0	6-Assessment	t	3
\.


--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."profiles" ("user_id", "first_name", "last_name", "is_teacher") FROM stdin;
de8ae3d4-c82e-429e-9ba6-c74180779aa0	Leroy	Salih	t
69c807fb-46f0-4f30-a711-5cdb092dd602	Leroy G.	Salih	f
8f719803-c401-44e4-bf15-f4a5121457c4	Ali	Koyuncu	f
cec24431-e395-474b-803d-1ea816c7fca4	Leroy	Salih	t
63f9d3dd-c0ab-455d-b277-e1d6ed72cb2c	Leroy	Salih	t
a5121160-1fcd-4a2f-86d5-e5e018b4a2a5	Pupil	Test	f
50174a72-4c63-464e-bc8f-76d0cdb9caf0	Aurell	Vania	f
e25087b7-f44d-4ea5-a469-5f9543d69bf1	Pupil 2	Test	f
3352f5a2-3c8b-420e-90b7-d95ab6f1756c	Pupil 1	Test	f
a59a492b-cb3d-499e-9152-1b0793ce7b44	Pupil 3	Test	f
1b83349c-3b8b-4ab0-aae9-470a4d085469	Pupil 4	Test	f
da365bd8-7aa5-4ffb-acf0-2afaaf7152b6	Pupil 5	Test	f
47096e19-2f45-4b45-8e60-f9d71eef8168	Pupil 6	Test	f
4acef84a-35aa-4bf3-be92-c5c9f66dfe69	p10	Test	f
5e569c2b-17ee-4b5d-af58-820b9c9882df	Roba	Awad	f
48da2f2e-545c-4ba3-9538-c018c81c757f	Fernando	Sanchez	f
c6502fb1-8970-456f-ab45-ff3ab0584dd3	Malek	Sahli	f
46340dab-faa0-4f2d-8980-bf4c98d00c6c	Agustina	Peirano	f
e19a785b-0e0f-40b4-b839-c6ba381f5351	Charles	Parone	f
5a2b3e7a-2276-43b0-8bde-bec7677c3ed2	Hadiyah	Noor	f
7e3f6a84-e2ec-458c-953e-bb83bd693ecc	Katerina	Poole	f
2709f3c7-a488-467c-9c44-de36e1e9efda	Rhys	Viola	f
6df706e1-deb4-4548-81cc-82d2fd481c05	Meral	Elshiekh	f
0c66c9e3-ad69-4a39-be10-59c48d04c65a	Muhammad	Mohamed	f
59e6f57c-7b4e-4c5c-85c2-ae95990e692a	Eesa	Ehsan	f
f4edc5de-aa0a-4cf1-8590-15275633126e	Nour	Mohsen	f
87256a00-fff4-47a4-b64c-c32b48b8f3c3	Diana	Nadezhdina	f
baa7c664-9065-4cb9-9baa-69d385e7bcbe	Haad	Zaman	f
0503adf6-4e05-4f0d-8802-660dcfbee96c	Loay	Badawi	f
81a9b148-9ff0-4678-8178-1fe37e8afe72	Rosanna	Nascimento	f
c4f2521e-86c2-43a6-a680-4f5b642c3dd7	Dani	Alsaadi	f
24d1c27d-3365-4ceb-8909-c9c08444af9f	Nanya	Akiri	f
50304a54-2c10-44a1-8c87-b3535a960e28	Leroy	Salih	t
f69e0ef5-9d5b-41bf-857b-c78e20e75c1d	Chloe	Jubran	f
ece878d8-6e44-4f37-b38b-99dbd19f5518	Ibraheem	Kamran	f
c0f570d7-9772-4a31-b5cd-d78e702f4dcb	Hyeyun	Na	f
cbc7e991-08eb-4838-a10c-3ea2cb10e2d8	Saffiyah	Piracha	f
dd25ed75-81f6-4275-b40a-78bb8c583b2a	Ece	Eryurt	f
299700ea-30c7-4da4-996b-59f1ad159a19	Rumaysa	Uddin	f
a743e51a-3552-4915-8d77-edc57715a677	Raymond	Fola-Fatola	f
346d62db-eb7a-4c5e-b798-7dec26f75302	Abdullah	Khan	f
3bbc42b1-4ea6-48e3-84ad-6966551a3802	Seve	Henry	f
a0380237-abea-4988-84c7-c9d43179d2be	atharv	garg	f
964430f8-1194-4c00-a640-b795663c24e1	Francisco	Romay Sequeiros	f
f6bdf187-d0bc-4c37-8034-202cfb4fb6db	Clara	Ku	f
969dbda5-2815-41e3-84bd-d14dd102eb39	Mohammad	Syed	f
6fd3433f-e468-4d21-b42b-36ea1ab60db7	Molly	Kearney	f
71fc12a2-b572-4853-869d-a31bbc71d7b7	Dhriti	Sangaru	f
e1ee44b9-0153-4d85-ab89-131b71189383	Muhammad-Abbas	Naqvi	f
14b19cda-dd95-4ead-bf2e-9cb53d0c9524	Taimas	Bissengaliyev	f
8896700d-4f9e-466f-8b1b-f3d24de12076	Subhan	Faisal	f
25e0ec02-c0f2-4a5b-b705-49976155939d	Zunairah	Siddiqui	f
2ec08e87-597a-4c62-91f5-7611d54019f7	Sabian	Peterson	f
cb62c43b-aca7-491a-949d-fb395e5ae1e2	Sam	Jaiswal	f
e67e364e-6521-471f-afad-d1b2002733c7	Suhaib	Abouelela	f
221ad246-e0a0-4f41-9fce-a245b9a857f7	Raphael	Johnson	f
9bfaa2e6-87ca-423c-af3a-b29b40f5f5db	Haya	Al Haddad	f
693e7720-4a1b-4379-993d-4a99b1ab4c15	Liam	Mahmoud	f
d4b7fb1a-fc13-4878-ac15-2ac89009449a	Amin	Akram	f
6c3bc1a2-792e-434e-9098-27065b69bacf	Yan	Ma	f
0a976181-0665-4c8b-a843-bb4b743de561	Hem	Jinka	f
7ce65557-6f3b-4637-b771-b903f70ab024	Sara	Haouari	f
1ceb90c6-1724-47a9-a8ee-b360a9640298	Eiliyah	Jamal	f
a8bb99b2-5bf9-4b92-9e54-2c1843b7300b	Bilal	Aziz	f
fc6f7281-baf1-4c72-81fe-b91e78dfc685	Lea	Dindial	f
b2b6227a-0371-48be-8a6a-1ca741597953	Ibrahim	Jeelani	f
41be1008-67a4-4e15-95fb-36f5c333f13f	Sophia	Henry	f
0624a38a-8a1a-45f7-93a7-cba3b6c78794	Jawad	Khan	f
04638d3b-cf50-4724-a566-4fbd3e266de5	Kamar	Achrafi	f
8aa0e2ec-19f2-423d-b8c4-697539e010a0	Hussain	Balagamwala	f
35a5544d-1d93-4354-b4d1-fd74497b917f	Razeen	Kallachi	f
6c39f828-ca07-4100-8415-0af0cf8d6e25	Zaina	Satti	f
0f7f42d8-08c3-480e-ae49-fecd1f566e2a	Salma	Misbah	f
d63b381b-362f-4467-8127-258c736ae789	Moneeb	Khatimi	f
9ec0b86d-d060-4a2b-8841-5129ddc0ca27	Mohamed	Abouebeid	f
66b3ac3a-a491-4c2f-958c-d74151ec5618	jana	bahomed	f
aede0bdf-1c12-4a7b-a17b-aa619485ac96	Shirin	Patel	f
72764b6b-f518-4d9f-b044-beebaf5da7b6	Harry	Fejsa	f
3463a79d-c69a-4349-90d9-07b359099bf9	Kinan	Kanaan	f
9d9a3dfc-cf3e-4b12-acad-2ce5c4992fac	Katelyn	Boom	f
27aea387-1140-456d-8094-5528755b8ebc	Malek	Ayman	f
e7a2170f-64e0-4314-9175-7be5e99e5577	Ana	Mesa	f
d2023f55-f793-4f78-ac7c-2fcd4136917b	Nour	Elsherif	f
b81d8ba6-e7e8-4ab9-a13e-126e3458110b	Mohammed	Aboobacker	f
037f394f-e8b8-493f-aee8-9cf230b84a8d	Rayel	Zeghouani	f
7fe51a55-fa11-4763-b075-acbf88b2fba3	Elena	Miraldi	f
a0e10f68-fd3f-47bf-af1b-e943e9112418	Adem	Menacer	f
087cdeca-2026-4311-97ac-773a071ae72e	Adham	Mohamed	f
6f41a8df-a416-4969-8c85-0d73b94b911a	Tristan	Benfield	f
c2ce779b-b425-4a64-bc39-e4e4169efb97	Aya	elabid	f
72a08bf8-2275-4d9d-896a-0b090e1feea0	Ainoor	Rauf	f
e061cf0c-7376-4b76-b144-191759658356	Agustina	Flores	f
5a0490f9-9492-4249-b978-22d05612df5c	Emily	Boom	f
9dc71764-db62-4488-be1c-592d88ec5d40	Ayush	Singh	f
48e5bfbf-0f90-4da4-98ec-eca3e3c05942	Hala	Hegab	f
3c25ee6f-5212-40ae-9bfe-11d7ddf72fad	Raihan	Paramban	f
d38d1069-803b-45c4-8e85-4dc03c0b57fe	Haniya	Khan	f
47458c31-68f8-46ec-8746-f96e8573ed80	amanda	cardenas	f
cb49f6b3-3942-43ae-85a0-c046e619d9d6	Malika	Sharaf	f
2a93e990-de8d-4198-a28a-f9e03f63d0f1	Joana	Rifat	f
72280995-c969-4477-a0eb-859b58e3cc02	MAYAR	ELSHIEKH	f
43674f5f-609d-4eb4-bbd5-7702e25fd90c	Karma	Eldessouky	f
fb6d9eb9-bba1-4c1a-b68c-e6de19560409	Safiya	khan	f
655ba3ff-7e8b-48ef-af73-8f8ef09f50c1	Yasmin	Bendjaballah	f
dc7001ff-45c8-4e16-9475-38b2da804b87	Muhammad	Jasim	f
a150e71f-5456-47c8-9cdc-354cb555375e	Adonis	Rojas	f
a9c83066-f970-4ed1-8f7d-639924433f2e	Uzair	Saeed	f
dd6b4b3a-6917-4bc0-9b58-074005f446ff	Maria	Furqan	f
08523f36-2ccd-4783-a959-6220539275a6	Thomas	van der Horst	f
069c8bb7-12d5-4ecf-aaee-5705c8485232	Evelyn	Mcwhirter	f
8f0329ce-c479-4707-aa73-8fcc06cb8b0e	Mohamed	Elagamawy	f
199b1891-3db2-46cb-9fdf-e59f3f43a549	Wian	Pretorius	f
c3dcc007-c7b4-4b5f-9117-8f56735bc41d	Arham	Zeeshan	f
9343b61d-ddeb-4a03-a63b-4f86cdc99d8a	Ryan	Tee	f
a201e5ab-b434-44b4-ad1a-629746f828a0	Lilyan	Badawi	f
07669b35-d7e3-4da7-b025-a723307dc299	yoseph	aljazzar	f
061b87c2-7d60-42df-a8ce-64b6bd0a51c0	Abdullah	Muhammad	f
6c0e385b-63db-49c1-901c-045a0fab4c2e	Mariano	Flores Ibarra	f
123fa306-359e-49cf-ab4f-9d01fa0547e3	layla	kabel	f
351935f3-656b-4c74-9122-9098796a9677	Hana	Atwa	f
46699a4b-e7ab-4d37-b1d3-9e7d0ea8578b	Hasya	Zahiyyah	f
decb53c4-8145-409e-920f-92529df8e1cb	Iyed	Menacer	f
70a8b61a-29e6-490c-b817-1c12b5a852ea	Eryna	Safwan	f
1bc4f3e0-552b-4d1c-a1a8-809a1a30d982	Mumin	Ismat	f
6c0a43fc-b677-4e89-a3a6-8d5a987b91f7	Elena	Romay	f
cd922ea2-94e6-4c64-a4d3-d409dcddf89a	Maryam	Huseynova	f
c74b5968-eb5d-4913-8c9a-c8d3e712caeb	Abrar	Latif	f
45c783f1-06c2-410e-bdff-cff20d0f8f28	Fatimah	Rehman	f
77e7baed-219a-4eeb-8e85-3d06240c7a61	Tomi	Adeniyi	f
3bb38960-cdf9-4f24-a0b3-fa3dfefa73f7	Yusra	Eltayeb	f
9a8864c2-cefe-4a6f-8430-61825ef54198	Amir	Bendjaballah	f
81140397-32b3-4644-990e-59f640dffac7	Mariam	Hamouda	f
3c4257e4-2e66-42bf-930c-c0c9d4bb0e82	Ibrahim	Liban-Hussein	f
444533bb-fe16-412d-940f-59a7aca92c15	Aytin	Aboud	f
83c63f3e-7366-4858-9f9a-5a7713037638	Raed	Al-masri	f
918be17c-e235-478e-931e-0f1d19d74b45	Tamim	Ehsan	f
f3339dc5-864c-4eae-a531-e2be9456134e	Xiyue	Zhang	f
eb0001b7-4a89-4eef-9fb2-c9612fffe809	Ali	Usman	f
9c288a10-ca2d-4068-80d6-04bca9462151	Felix	Salim	f
0a20f144-ba6c-4eba-99cf-0a796f236738	Luana	Correa	f
5a4c5afb-183f-4384-a983-685a130044f4	Ezaan	Khawaja	f
892cdae9-dc52-4696-88e8-f876f95cc305	Laila	Shaheen	f
12459f9a-f630-4aa3-8099-ac4d98bf0f13	Maria	Haboune	f
0a7ac8b1-d098-47b8-859c-76287cdb317b	Aderinsola	Aremu	f
18afaf36-2649-4e4f-b21f-1b9c58e1a6ac	Naya	Abu-Ghazaleh	f
f7afb571-80b2-4ddd-996c-c88a55e7ad97	Alinur	Aliken	f
4459487d-e00e-4ffb-ae6c-778a55eaba4c	Mert	Birecikli	f
6bbc6a35-167e-436e-8e09-456b046ae1bf	Sanae	Bouchekif	f
255b0b13-9462-4f1c-b7f3-2c2da194e11c	Safiya	Bissengaliyeva	f
973f80b1-aa45-4cf1-bc45-7db8d5d69a56	Adam	Hedaia	f
451acd3e-8a29-4ce9-a5b2-cf2f568a9f0b	Jayden	Erebor	f
37077463-85c3-4918-80b0-e6bf5ffac82c	Jasmin	Hammoudeh	f
56cec57f-298f-474e-9156-efd46b3d6e5b	Alba	Gaughan	f
81ae3b82-97c3-412d-9081-79ab01bad4f7	Arhaan	Mohabir	f
296bc5d4-2316-44e4-b619-77b18ad8187a	Amanda	Wee	f
3b3243b1-2a90-4ef7-8be9-2671053fa499	Hamza	Saeed	f
664e7417-d6a6-4234-a294-1236e49ee813	Logan	Diener	f
78df1414-b07d-4bb1-a975-888976f0cec3	Zaid	Hamad	f
724adbe5-ed2f-41d3-9c6d-c4b6ef713bef	Talia	Alkhateeb	f
aa0c3979-03ee-4683-a11d-ed3bd265ac71	Sofia	Cholovskaya	f
1bf70daa-7d8d-4a08-86bc-c60d1f639144	haram	farooq	f
ce965175-ccbf-4472-9d6e-1f77125fbaef	saif	mir	f
0fb2b917-e310-4724-817f-5e1cf7508b9d	Yassine	Othman	f
10b3aadf-d1e6-4087-9338-be2904da256e	Lama	Alameddine	f
759de2b8-d6d6-4c15-9974-d2afc54fc49f	Raza	Saeed	f
d6915c34-31b9-4225-9597-772452fc07bc	serena	taleb	f
a21f4f66-871a-4119-b1b9-9cac07526fc2	Muhammad	Umer	f
0b7daafd-2fad-4638-8936-6004b4ba3575	SULEYMAN	VALIYEV	f
bb22e5df-6b70-45bb-ada3-7e7a4f63984d	Hani	Dakhia	f
1f5cd3b2-9bc7-42d1-9610-6888fc2663d4	Farida	Metwally	f
4284fdc3-83c4-46bf-b991-aa721c6265f8	Abdulrahman	Al-Zoubi	f
58d719a3-c060-4a62-8032-5e0f96167a9c	Anaya	Haider	f
81ede5d3-7f5b-43f2-be8d-56df25dddb62	Linda	Aboelela	f
a05e7fc3-20c5-4a0a-a26b-118e23c866c3	malak	elkholy	f
607b28a9-f095-4e5f-8da0-fb92a9ed368f	Khalifa	Agnia	f
5ddc5f8b-e70c-40ce-84b8-a03f58dec57d	Sara	Abou Hechme	f
2dc65039-db93-46af-aeec-b0ac2ffa2a9c	Azaan	Vajid	f
ffd45e59-2893-4f2b-90a2-4c20eb3e5eb9	Muhammad	Kashif	f
6252da5f-5352-44c9-9fe3-5cf73fbf2bb3	yousef	Radwan	f
3bba498c-145d-401e-9196-1f8c67ccf30e	Ibrahim	Raza	f
a4962c40-be52-4b68-9795-ee5b8cfbd3e6	Rafi	Al Saadi	f
7ae4eb4c-c279-4fc1-8243-e4ca467914db	ibrahim	bahomed	f
bcb8c5d1-ccb9-4c76-a728-c0af5aef3410	Tasnim	Souiai	f
c8f8ecc7-2257-40b7-9d44-21985375c591	Tomas	Aguirre	f
720174a7-fd1c-443c-a9b4-70f0589328cf	Azaa	Mahmud	f
\.


--
-- Data for Name: submissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."submissions" ("submission_id", "activity_id", "user_id", "submitted_at", "body") FROM stdin;
c99364eb-57e0-4ec7-8acc-c0bf7c065ff3	dccefe60-c3f0-4872-9a46-386653da241c	892cdae9-dc52-4696-88e8-f876f95cc305	2025-10-16 04:42:46.775+00	{"answer":"","teacher_override_score":0.75,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
5f9a2a4b-d439-49b1-9dec-5c175cd81865	dccefe60-c3f0-4872-9a46-386653da241c	5ddc5f8b-e70c-40ce-84b8-a03f58dec57d	2025-10-16 04:44:35.76+00	{"answer":"","teacher_override_score":0.6666666666666666,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
9150231e-6984-4d75-ab8e-4b7bcc0ce71d	17adbcc6-5585-4589-86d8-e2e3afb5f709	3352f5a2-3c8b-420e-90b7-d95ab6f1756c	2025-10-13 17:20:38.322+00	{"answer_chosen":"option-b","is_correct":false,"teacher_override_score":0.375,"teacher_feedback":null,"success_criteria_scores":{"32c9e025-e8ad-4d50-b25c-c59d2524b0cd":0.5,"6bfdf9bd-d381-4313-b4b3-d0c6d1968a48":0.25}}
76e03478-b4ea-4b0c-811a-c932f6f5ccb3	dccefe60-c3f0-4872-9a46-386653da241c	ffd45e59-2893-4f2b-90a2-4c20eb3e5eb9	2025-10-16 04:35:49.486+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1},"teacher_override_score":0.75,"teacher_feedback":null,"teacher_created_submission":true}
0f2ebb14-1d4a-412f-a9ce-c6264a40f0d8	dccefe60-c3f0-4872-9a46-386653da241c	7ae4eb4c-c279-4fc1-8243-e4ca467914db	2025-10-16 04:37:10.617+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":0.5,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1},"teacher_override_score":0.375,"teacher_feedback":null,"teacher_created_submission":true}
75f21dd0-b52b-4e82-82e9-f957ce97af7c	dccefe60-c3f0-4872-9a46-386653da241c	720174a7-fd1c-443c-a9b4-70f0589328cf	2025-10-16 04:45:17.039+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1},"teacher_override_score":0.625,"teacher_feedback":null,"teacher_created_submission":true}
9891836e-b75b-4e15-83f1-d94cd9b01cf4	dccefe60-c3f0-4872-9a46-386653da241c	bcb8c5d1-ccb9-4c76-a728-c0af5aef3410	2025-10-16 04:46:05.349+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1},"teacher_override_score":0.5,"teacher_feedback":null,"teacher_created_submission":true}
9f62c469-119f-49c3-8d8c-8b19916a8c5a	dccefe60-c3f0-4872-9a46-386653da241c	c8f8ecc7-2257-40b7-9d44-21985375c591	2025-10-16 04:26:33.263+00	{"answer":"","teacher_override_score":0.4166666666666667,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
cc512f49-e51c-4f00-b133-fb7597435d66	dccefe60-c3f0-4872-9a46-386653da241c	2dc65039-db93-46af-aeec-b0ac2ffa2a9c	2025-10-16 04:37:55.97+00	{"answer":"","teacher_override_score":0.5,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
8cd7f126-d452-4a94-8e49-9ac1e8f6fa87	dccefe60-c3f0-4872-9a46-386653da241c	1bc4f3e0-552b-4d1c-a1a8-809a1a30d982	2025-10-16 04:39:12.993+00	{"answer":"","teacher_override_score":0.6666666666666666,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":1,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
69bdf93e-5ee7-435c-b288-396c06de5449	dccefe60-c3f0-4872-9a46-386653da241c	6252da5f-5352-44c9-9fe3-5cf73fbf2bb3	2025-10-16 04:39:48.79+00	{"answer":"","teacher_override_score":0.25,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":0.5,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
25709dad-5a9e-4677-a81d-cf6783d109e3	dccefe60-c3f0-4872-9a46-386653da241c	a4962c40-be52-4b68-9795-ee5b8cfbd3e6	2025-10-16 04:40:43.088+00	{"answer":"","teacher_override_score":0.3333333333333333,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":0.5,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
0d9e4160-c5c8-4333-b140-0ec00f1561c6	dccefe60-c3f0-4872-9a46-386653da241c	81ede5d3-7f5b-43f2-be8d-56df25dddb62	2025-10-16 04:41:26.392+00	{"answer":"","teacher_override_score":0.75,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
ca1419b2-55ab-4ca7-b9aa-8a97a903b91d	dccefe60-c3f0-4872-9a46-386653da241c	aa0c3979-03ee-4683-a11d-ed3bd265ac71	2025-10-16 04:41:55.239+00	{"answer":"","teacher_override_score":0.5833333333333334,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
785a77e7-b116-4f07-9de2-c5bec2488618	dccefe60-c3f0-4872-9a46-386653da241c	cb49f6b3-3942-43ae-85a0-c046e619d9d6	2025-10-16 05:19:04.05+00	{"answer":"","teacher_override_score":0.6666666666666666,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
b7aae4f0-ad8f-4cf1-9fde-697b8be80ebf	dccefe60-c3f0-4872-9a46-386653da241c	1bf70daa-7d8d-4a08-86bc-c60d1f639144	2025-10-16 05:19:28.808+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1},"teacher_override_score":0.875,"teacher_feedback":null,"teacher_created_submission":true}
09131ea7-49ca-40b4-91fe-5f171336864e	dccefe60-c3f0-4872-9a46-386653da241c	724adbe5-ed2f-41d3-9c6d-c4b6ef713bef	2025-10-16 05:51:27.478+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1},"teacher_override_score":0.875,"teacher_feedback":null,"teacher_created_submission":true}
e35992b3-f2db-4817-8fce-16199ef653b7	dccefe60-c3f0-4872-9a46-386653da241c	bb22e5df-6b70-45bb-ada3-7e7a4f63984d	2025-10-16 05:57:15.224+00	{"answer":"","teacher_override_score":0.5,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
7ce114fd-1f0a-421d-90ce-68483c896e39	dccefe60-c3f0-4872-9a46-386653da241c	664e7417-d6a6-4234-a294-1236e49ee813	2025-10-16 05:17:15.396+00	{"answer":"","teacher_override_score":0.5,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
ce658ab4-fa35-4d5f-a36c-b367f89a2d65	dccefe60-c3f0-4872-9a46-386653da241c	a9c83066-f970-4ed1-8f7d-639924433f2e	2025-10-16 06:01:59.443+00	{"answer":"","teacher_override_score":1,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":1,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":1,"e02cecb6-8178-4a08-8698-432a566f922d":1},"teacher_created_submission":true}
bf4945b4-6a63-40b7-8555-5cbe415411a1	dccefe60-c3f0-4872-9a46-386653da241c	069c8bb7-12d5-4ecf-aaee-5705c8485232	2025-10-16 06:02:28.322+00	{"answer":"","teacher_override_score":0.75,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
e121442f-200e-4478-959d-ff9cd9208981	dccefe60-c3f0-4872-9a46-386653da241c	5a4c5afb-183f-4384-a983-685a130044f4	2025-10-16 05:17:46.277+00	{"answer":"","teacher_override_score":0.5833333333333334,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
5e0e0fac-8308-497c-9083-305ca2763479	dccefe60-c3f0-4872-9a46-386653da241c	d6915c34-31b9-4225-9597-772452fc07bc	2025-10-16 05:19:55.835+00	{"answer":"","teacher_override_score":0.5,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
0bbbbd48-3abd-486b-90e0-08203cdcc4fd	dccefe60-c3f0-4872-9a46-386653da241c	10b3aadf-d1e6-4087-9338-be2904da256e	2025-10-16 05:51:47.972+00	{"answer":"","teacher_override_score":0.5833333333333334,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
2ac93ad3-1ef2-456f-aa40-c7eda8c94ccb	dccefe60-c3f0-4872-9a46-386653da241c	81ae3b82-97c3-412d-9081-79ab01bad4f7	2025-10-16 05:56:43.141+00	{"answer":"","teacher_override_score":0.5833333333333334,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
1a300932-bc4f-4773-88a9-1d9bf8588d9b	dccefe60-c3f0-4872-9a46-386653da241c	3b3243b1-2a90-4ef7-8be9-2671053fa499	2025-10-16 05:57:29.88+00	{"answer":"","teacher_override_score":0.5,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
26310e7a-0d4f-4448-a14a-9bdf75fbeb70	dccefe60-c3f0-4872-9a46-386653da241c	0b7daafd-2fad-4638-8936-6004b4ba3575	2025-10-16 05:58:18.194+00	{"answer":"","teacher_override_score":0.75,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
94781ae6-7ff2-470e-8aea-da2f02fa507f	dccefe60-c3f0-4872-9a46-386653da241c	607b28a9-f095-4e5f-8da0-fb92a9ed368f	2025-10-16 04:25:00.684+00	{"answer":"","teacher_override_score":0.3333333333333333,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":0.5,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":0,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
064c04a4-a8d7-46a1-a934-3c91ceeaada9	dccefe60-c3f0-4872-9a46-386653da241c	4284fdc3-83c4-46bf-b991-aa721c6265f8	2025-10-16 04:36:28.304+00	{"answer":"","teacher_override_score":0.5833333333333334,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
cd5c3b69-9969-4d9d-97d4-7bef968050af	dccefe60-c3f0-4872-9a46-386653da241c	a05e7fc3-20c5-4a0a-a26b-118e23c866c3	2025-10-18 14:02:36.468+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_override_score":0.5833333333333334,"teacher_feedback":null,"teacher_created_submission":true}
e2564308-e9b6-44ef-b33d-db1218c3dcc4	dccefe60-c3f0-4872-9a46-386653da241c	1f5cd3b2-9bc7-42d1-9610-6888fc2663d4	2025-10-16 04:43:59.801+00	{"answer":"","teacher_override_score":0.5833333333333334,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
cdd94be3-0397-44d8-b68c-632ae377ea0a	dccefe60-c3f0-4872-9a46-386653da241c	58d719a3-c060-4a62-8032-5e0f96167a9c	2025-10-16 04:46:41.314+00	{"answer":"","teacher_override_score":0.6666666666666666,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
7aa581c7-8298-4ef7-be35-5863f2ba2d4e	dccefe60-c3f0-4872-9a46-386653da241c	a150e71f-5456-47c8-9cdc-354cb555375e	2025-10-16 06:03:29.379+00	{"answer":"","teacher_override_score":0.6666666666666666,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":1,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
b4be09f4-8490-459d-bb30-2c2e6a29591e	dccefe60-c3f0-4872-9a46-386653da241c	fb6d9eb9-bba1-4c1a-b68c-e6de19560409	2025-10-16 06:04:10.948+00	{"answer":"","teacher_override_score":0.5,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
ee5434d0-a729-4b37-9f3d-55010cdebb61	dccefe60-c3f0-4872-9a46-386653da241c	08523f36-2ccd-4783-a959-6220539275a6	2025-10-16 06:05:00.358+00	{"answer":"","teacher_override_score":0.5833333333333334,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
06d95655-a507-402b-aa05-b5484381295b	dccefe60-c3f0-4872-9a46-386653da241c	dd6b4b3a-6917-4bc0-9b58-074005f446ff	2025-10-16 06:05:24.467+00	{"answer":"","teacher_override_score":0.75,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
95afb434-8a9f-41a5-932a-ae31fccdd68f	dccefe60-c3f0-4872-9a46-386653da241c	655ba3ff-7e8b-48ef-af73-8f8ef09f50c1	2025-10-16 06:06:00.379+00	{"answer":"","teacher_override_score":0.75,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":1,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
e62d8383-83af-4fa5-add7-e9e781ab0bc0	dccefe60-c3f0-4872-9a46-386653da241c	43674f5f-609d-4eb4-bbd5-7702e25fd90c	2025-10-16 06:06:28.062+00	{"answer":"","teacher_override_score":1,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":1,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":1,"e02cecb6-8178-4a08-8698-432a566f922d":1},"teacher_created_submission":true}
e912d12d-3088-444e-b83d-9c1a1003348d	dccefe60-c3f0-4872-9a46-386653da241c	eb0001b7-4a89-4eef-9fb2-c9612fffe809	2025-10-18 14:18:10.358+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":1},"teacher_override_score":0.75,"teacher_feedback":null,"teacher_created_submission":true}
728d65b3-50f5-4192-a2a2-b7ca039a707e	dccefe60-c3f0-4872-9a46-386653da241c	f7afb571-80b2-4ddd-996c-c88a55e7ad97	2025-10-18 14:18:52.021+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":1},"teacher_override_score":0.75,"teacher_feedback":null,"teacher_created_submission":true}
12716fc3-31d7-4fb9-aa96-16fe29ee4b01	dccefe60-c3f0-4872-9a46-386653da241c	3c4257e4-2e66-42bf-930c-c0c9d4bb0e82	2025-10-18 14:19:51.541+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":1,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_override_score":0.75,"teacher_feedback":null,"teacher_created_submission":true}
770a8d1a-4fc8-4deb-8dbb-7564f8b467a4	dccefe60-c3f0-4872-9a46-386653da241c	f3339dc5-864c-4eae-a531-e2be9456134e	2025-10-18 14:25:10.944+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0.5,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_override_score":0.75,"teacher_feedback":null,"teacher_created_submission":true}
2328cc3a-f675-4e4f-a64a-7143af05759c	dccefe60-c3f0-4872-9a46-386653da241c	0a20f144-ba6c-4eba-99cf-0a796f236738	2025-10-18 14:25:50.439+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":1,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":1},"teacher_override_score":0.8333333333333334,"teacher_feedback":null,"teacher_created_submission":true}
4e6b37ba-a035-4e07-a3b8-f5944a90e81c	dccefe60-c3f0-4872-9a46-386653da241c	6bbc6a35-167e-436e-8e09-456b046ae1bf	2025-10-18 14:26:23.77+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_override_score":0.5,"teacher_feedback":null,"teacher_created_submission":true}
103500d7-3587-4c0e-a9e3-a9205485f271	dccefe60-c3f0-4872-9a46-386653da241c	83c63f3e-7366-4858-9f9a-5a7713037638	2025-10-18 14:27:36.725+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":0.5,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":0,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_override_score":0.16666666666666666,"teacher_feedback":null,"teacher_created_submission":true}
42719435-f85a-49dc-8d73-4152d8294f9d	dccefe60-c3f0-4872-9a46-386653da241c	918be17c-e235-478e-931e-0f1d19d74b45	2025-10-18 14:28:23.783+00	{"answer":"","teacher_override_score":0.25,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":0.5,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":0.5,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
08d9f075-5111-4bbb-827e-39906aa23bb4	dccefe60-c3f0-4872-9a46-386653da241c	9c288a10-ca2d-4068-80d6-04bca9462151	2025-10-18 14:30:07.043+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":1,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":1,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_override_score":0.9166666666666666,"teacher_feedback":null,"teacher_created_submission":true}
1593ec9f-ed2e-41d1-bdf6-8e02b83f5217	dccefe60-c3f0-4872-9a46-386653da241c	973f80b1-aa45-4cf1-bc45-7db8d5d69a56	2025-10-18 14:30:46.502+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_override_score":0.4166666666666667,"teacher_feedback":null,"teacher_created_submission":true}
a2b3a6e1-0a91-4438-9195-59d1b51afdba	dccefe60-c3f0-4872-9a46-386653da241c	81140397-32b3-4644-990e-59f640dffac7	2025-10-18 14:31:33.988+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":1,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":1,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":1,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_override_score":0.9166666666666666,"teacher_feedback":null,"teacher_created_submission":true}
161b2e3a-e34c-4b13-9d9b-ce76992d608c	dccefe60-c3f0-4872-9a46-386653da241c	a21f4f66-871a-4119-b1b9-9cac07526fc2	2025-10-16 05:52:36.693+00	{"answer":"","teacher_override_score":0.5,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
4bb785b9-ca94-447a-a1f0-1e68f689ebcd	dccefe60-c3f0-4872-9a46-386653da241c	37077463-85c3-4918-80b0-e6bf5ffac82c	2025-10-18 14:20:21.901+00	{"answer":"","teacher_override_score":0.5833333333333334,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0.5},"teacher_created_submission":true}
8262ba78-d337-4d85-b194-b89c1105430c	dccefe60-c3f0-4872-9a46-386653da241c	296bc5d4-2316-44e4-b619-77b18ad8187a	2025-10-16 05:59:35.99+00	{"answer":"","teacher_override_score":0.4166666666666667,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
414efc75-97aa-4244-be81-32fe0ef66187	dccefe60-c3f0-4872-9a46-386653da241c	78df1414-b07d-4bb1-a975-888976f0cec3	2025-10-16 05:58:34.193+00	{"answer":"","teacher_override_score":0.25,"is_correct":false,"teacher_feedback":null,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":0.5,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0,"37fccff6-414c-463c-8d20-68489df1e0f3":0.5,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":0},"teacher_created_submission":true}
73c91d4f-1b5c-4398-895f-ccda28e3b04d	dccefe60-c3f0-4872-9a46-386653da241c	56cec57f-298f-474e-9156-efd46b3d6e5b	2025-10-18 14:43:06.064+00	{"answer":"","is_correct":false,"success_criteria_scores":{"f53315cb-f3b0-4328-8133-1f2c91f91bfe":1,"b59cca57-9e74-4a95-ad37-5db8c3383ebc":0.5,"c6027ce2-2cb1-427e-8130-81ed9fac5d93":0.5,"37fccff6-414c-463c-8d20-68489df1e0f3":1,"9975d1de-864a-4175-861b-ffa70938efbd":0,"e02cecb6-8178-4a08-8698-432a566f922d":1},"teacher_override_score":0.6666666666666666,"teacher_feedback":null,"teacher_created_submission":true}
\.


--
-- Data for Name: success_criteria; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."success_criteria" ("success_criteria_id", "learning_objective_id", "level", "description", "order_index", "active") FROM stdin;
54b4e504-7bd3-4133-8d20-39b1ee29181d	51f016ec-d795-4dae-bd45-e9b6d2731da6	1	I can name the four stages of the Design Process.	0	t
5f2b7707-db53-4b6f-9890-fa65f9154e6d	51f016ec-d795-4dae-bd45-e9b6d2731da6	1	I can answer the questions "What is Design and Technology?"	1	t
67cbf83f-0749-4373-aa94-eda7221363d5	ca58a8a2-dddd-4842-b799-3cb52bf5ae09	4	I can use advanced features of extrude to align to distances or faces.	1	t
e6434c7d-7d8d-42dd-99ff-57980bd7a8fd	ca58a8a2-dddd-4842-b799-3cb52bf5ae09	5	I can use extrude to add, remove either new or existing parts.	0	t
c6e5c2f7-ed7c-4237-8730-d6de7fcf4cfc	51f016ec-d795-4dae-bd45-e9b6d2731da6	4	I can describe the structure of GCSE course assessment.	2	t
f53315cb-f3b0-4328-8133-1f2c91f91bfe	bae2ae66-9237-47b2-bbf0-2eee71ba2d27	1	I can draw cubes and cuboids in an isometric style.	0	t
37fccff6-414c-463c-8d20-68489df1e0f3	e9d2203e-2854-486f-a9bf-9dacb37d8035	1	I can use additive methods to construct complex shapes.	0	t
3f48008c-8d7e-4110-9a21-13ce40a0fcc8	402ecb15-38a1-42a6-9dd8-41d074561230	1	New success criterion	0	t
f8f7eee0-2611-4c0b-9ca8-b4fd1bb32533	974c9447-6828-46e0-aaae-d4be51365079	1	New success criterion	0	t
fa9fc3d7-d789-4aef-b4d9-afc48fa628e3	76db4bbb-e19d-4258-95b2-8b550ada9199	1	I can describe the computer use rules.	0	t
83b146f2-718e-4bc7-bbbc-73382cb05575	e9d2203e-2854-486f-a9bf-9dacb37d8035	1	I can use subtractive methods to construct complex shapes.	1	t
be239da2-aad5-4b97-951c-2ef1548752c1	5572f4d9-1904-4a79-a462-684677c1c950	2	I can create prisms	0	t
f9966d00-d4a0-43b1-add4-6e4201ffe96b	5572f4d9-1904-4a79-a462-684677c1c950	2	I can construct pyramids	1	t
c6027ce2-2cb1-427e-8130-81ed9fac5d93	c0f41566-4a8d-411f-9590-c6d12389d62c	3	I can draw cylinders in an isometric style	1	t
32c9e025-e8ad-4d50-b25c-c59d2524b0cd	76db4bbb-e19d-4258-95b2-8b550ada9199	1	I can describe the 5B's	1	t
6bfdf9bd-d381-4313-b4b3-d0c6d1968a48	76db4bbb-e19d-4258-95b2-8b550ada9199	1	I can describe the 5P's	2	t
7de602d1-30dd-481f-84c2-a427345db200	c00e9974-47b9-47e8-a757-df111e41c9a6	5	I can create a fully constrained sketch.	1	t
581aa31f-1c68-4599-9bfd-268185ec46ee	c00e9974-47b9-47e8-a757-df111e41c9a6	4	I can create a sketch on a plane usign basic skapes (rect, circle, arc, line)	0	t
8869391e-d6e2-45f2-a6fd-74bf2b400ddb	c00e9974-47b9-47e8-a757-df111e41c9a6	5	I can create a sketch on a plane using advanced shapes (project, snip, mirror, repeat)	3	t
2e92cb9a-55be-40f1-bede-76e16e008711	c00e9974-47b9-47e8-a757-df111e41c9a6	3	I can create, edit and share an OnShape Document.	2	t
07a38c75-be31-4f22-a453-a66b48960543	6abc9de2-6289-4731-8841-4cecdbe03f5b	2	I can collect online sources to use as an inspiration.	0	t
49a3ee17-169c-48be-86ec-9c42b07631b5	ca2438ad-4506-4433-98ae-88ec599dcf50	3	I can describe the motion of the 2 types of rockers (center pivot and end pivot)	3	t
aa06118e-5353-4e77-98f3-cf2192620d0b	f08a310a-707d-489e-a20b-8f3faf7531e8	2	I can use provided text to understand the history of a product.	0	t
2b42771e-3968-4eae-920e-65b251daf732	ca2438ad-4506-4433-98ae-88ec599dcf50	3	I can name the 2 types of rockers.	2	t
dded71d8-39cb-4578-87f4-9fa77cf0130d	f08a310a-707d-489e-a20b-8f3faf7531e8	3	I can find online sources to investigate the history of a product.	1	t
efe4345e-4535-4a8d-8aa7-c55885ca64ff	f08a310a-707d-489e-a20b-8f3faf7531e8	4	I can assess the suitability of an online source to investigate the history of a product.	2	t
5ce786a4-2aff-475d-9d50-e06ebc06a94a	f2b47b35-d92e-4b8c-93e7-993dabc78671	2	I can describe the rules of. stability to create a stable design.	0	t
f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	ca2438ad-4506-4433-98ae-88ec599dcf50	2	I can name the 3 types of cams.	0	t
7d9d3211-113e-4961-a536-84f3baa51028	ca2438ad-4506-4433-98ae-88ec599dcf50	3	I can describe the motion of the three types of cams	1	t
ba323877-7a98-4982-8be5-a1b9dcf6798e	6abc9de2-6289-4731-8841-4cecdbe03f5b	3	I can evaluate designs of existing products using ACCESS FM	1	t
9f02d427-7792-4cfe-aadb-8fefe86a40d0	98320bba-735e-4e8f-b074-b610d6b1976d	4	I can evaluate a final prototype against a design specification.	1	t
fe348aa8-b36c-4d26-8414-3ee7f4978188	98320bba-735e-4e8f-b074-b610d6b1976d	3	I can confirm that the final prototype matches my final design.	0	t
d0d032f9-dd39-4faa-89f5-f67c5cb8203a	6abc9de2-6289-4731-8841-4cecdbe03f5b	4	I can describe the works of an artist using ACCESS FM.	2	t
0002d172-8e97-44ca-8be2-e0193fccbcfa	1b665101-99a1-458e-8ee5-4bc469be79e3	4	I can create a full and measurable Design Spec	3	t
37864689-b68e-4958-810e-0492af84cec9	1b665101-99a1-458e-8ee5-4bc469be79e3	3	I can create a full (ACCESS-FM) design spec	2	t
279542cb-7139-467a-9cc3-0dda362fe8aa	1b665101-99a1-458e-8ee5-4bc469be79e3	2	I can create a partial design specification.	1	t
f16aac2d-8f8d-48a6-9b87-6bfa840ec83e	68b6deef-b853-4216-81c8-67b97f5957fe	4	I can compare renewable and non-renewable energy sources.	2	t
ce902b80-be18-421a-9d94-eb89a421dc4e	68b6deef-b853-4216-81c8-67b97f5957fe	5	I can identify fossil fuels (oil, gas, coal) and explain how they are used to generate energy.	0	t
23aff4ff-3ac3-489c-b367-eff501874058	68b6deef-b853-4216-81c8-67b97f5957fe	4	I can describe how renewable sources (biofuels, tidal, wind, solar, hydroelectric) generate energy.	1	t
77ceb96f-a565-45c4-a281-70b8c343e301	00197581-b55c-4569-aa1a-f7e627519d4a	4	I can describe how batteries and cells store and provide energy.	0	t
527f8fda-25bd-4e43-a05c-5afea854c611	00197581-b55c-4569-aa1a-f7e627519d4a	4	I can explain how solar cells generate energy from the sun.	1	t
2841d457-13a8-471d-8d70-1f0c9c27a3c5	071a529f-ece6-4c63-8880-ee7e3adbec2d	4	I can use RRACC to compare energy systems.	0	t
b59cca57-9e74-4a95-ad37-5db8c3383ebc	c0f41566-4a8d-411f-9590-c6d12389d62c	3	I can draw circles in isometric style	0	t
045f3f7f-333c-4b95-8d81-3d6e3d7ce2ba	4f5ee621-f38c-4086-b81a-9b1321e0fc26	4	I can use IMPACT to assess the impact of an emerging technology.	0	t
ec4cda64-e023-4b52-afea-1d9b6b7bbc85	4f5ee621-f38c-4086-b81a-9b1321e0fc26	4	I can use CUTEFEET to assess whether a technology is suitable	1	t
94114476-fc82-4d34-828f-317e8a24112d	4da307cc-d611-4088-a03a-0624faa6b19c	5	I can describe how smart materials respond to external stimuli such as heat, light, pressure or electricity.	1	t
c8961004-5a52-44a6-b1bc-8c3efb317836	4da307cc-d611-4088-a03a-0624faa6b19c	4	I can describe how smart materials respond to external stimuli such as heat, light, pressure or electricity.	0	t
757f57b4-588d-4941-b3a6-f739106d3be3	e08c9f58-4420-4aed-9fdb-f16efaa398b5	3	I can name and describe different types of digital devices.	0	t
620b8d0b-e0a4-4d4d-aafe-584eaab3f296	c75ce05e-0b46-4b3d-8150-5ab27bba2cb9	4	I can explain how digital devices are used in different contexts.	0	t
fc3da2a7-1de3-4f21-88e0-e74d5f3ba83e	762b48f7-0357-4935-b70c-8e4d289cfeb7	5	I can describe what multifunctional and convergent devices are.	0	t
8a75d83a-970c-45ca-b7da-b4371d11de10	be57b13f-0670-4a5d-965b-81ac7d96db10	5	I can compare composites to traditional materials to justify a choice.	1	t
9acea059-2bca-4478-b2e1-4343f225da5d	be57b13f-0670-4a5d-965b-81ac7d96db10	4	I can weigh up advantages and disadvantages of composites for different products.	0	t
e52fe58d-739b-4607-94ee-8a3af2674498	4b12c990-0712-44d0-ac6d-c7aa20f4d9e0	4	I can describe the functional properties of each type of technical textile	0	t
4012d28f-87b1-4fe6-9156-66e144dc717e	2d567e35-cfd0-4a00-8f9b-7dd8522f313a	3	I can use basic drawing tools to produce a 2D sketch.	0	t
c908b6c5-2ec4-4b2c-be71-f0830d491c0b	79fa10e0-9e6a-4665-b62a-6a6877ca0b67	1	I can create a set of initial ideas based without a framework.	0	t
81055c31-0b34-45db-a298-c0e87f09569d	4b12c990-0712-44d0-ac6d-c7aa20f4d9e0	5	I can analyse when and why a technical textile would be chosen over a standard fabric.	1	t
5a684b30-147c-4072-9a12-848f4d751fd9	2d567e35-cfd0-4a00-8f9b-7dd8522f313a	4	I can use dimension  tools to specify a 2D sketch.	1	t
742ac8af-a02d-4b7c-a182-359d0774c87a	79fa10e0-9e6a-4665-b62a-6a6877ca0b67	4	I can create a set of initial ideas based on SCAMPER	2	t
35e08f34-9ec9-4c9c-9062-2524ee4f984d	79fa10e0-9e6a-4665-b62a-6a6877ca0b67	2	I can create a set of 15 initial ideas based on the ideation framework.	1	t
6a80e5fd-6735-4209-ba87-34d3da28ecc3	ca58a8a2-dddd-4842-b799-3cb52bf5ae09	5	I can model a box, with lip and lid.	3	t
bd0c1b0e-26d4-4447-8dde-2d068014ba50	ca58a8a2-dddd-4842-b799-3cb52bf5ae09	4	I can model a simple 5 sided box	2	t
5498abd8-baff-4ad6-af04-0a5be2842b7c	d8b43f44-13ae-4bb6-bd13-ae8bbfd9529a	1	I can assess the suitability of an online source to investigate the history of a product.	0	t
af0f5607-42f0-4e78-8b6c-df5a51d0d04a	9d52d0ef-cbb7-4a4e-91da-1a4c777906ba	1	I can describe the works of an artist using ACCESS FM.	0	t
d35f788c-afa0-41dc-8181-268e3fec351f	2cc51b3c-b059-4685-b0a6-c80944cc755e	1	I can create a full and measurable Design Spec	0	t
bda92e85-e487-423c-b0ef-84889f3ebda8	56f2c728-984e-4e3f-ae0b-93e505c555dc	1	I can describe the motion of the three types of cams	0	t
59364ca5-859b-489c-9808-8ce3d5831ac4	56f2c728-984e-4e3f-ae0b-93e505c555dc	1	I can name the 2 types of rockers.	1	t
26e4e75b-fb6b-432e-9577-3be6966a704a	56f2c728-984e-4e3f-ae0b-93e505c555dc	1	I can describe the motion of the 2 types of rockers (center pivot and end pivot)	2	t
d3531b63-2f2f-4b3e-be9c-7b505beee351	324d1083-0008-42e3-98d4-022a2e9c5575	1	I can assess the suitability of an online source to investigate the history of a product.	0	t
73b12b35-7e87-4972-8f18-ae49502dbc4a	002fb840-bcb2-4e0b-8648-936c8a94197e	1	I can describe the works of an artist using ACCESS FM.	0	t
30ae76be-fea7-48b3-908b-c3fcfc193cf5	45f38eb2-6d6c-4709-bbcc-ea98fa6bb981	2	I can create a full and measurable Design Spec	0	t
56102034-f26e-402b-abf2-7e2fc389d08b	e0cfb5b3-cbac-44e2-9f18-b053f5885525	2	I can describe the motion of the three types of cams	0	t
b475f8fd-1f4c-4a39-9245-ad9c2f2f73bf	e0cfb5b3-cbac-44e2-9f18-b053f5885525	1	I can name the 2 types of rockers.	1	t
32534ede-215d-41e9-aa95-f831d4732b6d	e0cfb5b3-cbac-44e2-9f18-b053f5885525	2	I can describe the motion of the 2 types of rockers (center pivot and end pivot)	2	t
5fe436af-cc73-4811-9d00-009736d14b0a	58f3ebe0-eaa3-48e7-941f-48ce961ede46	4	I can create a 3D prototype of design using cardboard.	1	t
0e6862e8-ea24-4120-8985-57e0f77a91be	58f3ebe0-eaa3-48e7-941f-48ce961ede46	5	I can create a 3D protype of a design using foam, modelling clay or some other medium.	2	t
9b799694-4e34-40c8-8860-c327825864d9	9abe4247-d57b-4fcb-a067-165efeaf4849	4	I can extrude from a sketch using blind depth	0	t
70d5b2b1-4b26-464f-b2e2-1204475cc8f4	9abe4247-d57b-4fcb-a067-165efeaf4849	4	I can extrude from a sketch using face as the limit	1	t
61b92e1a-896e-4c1a-b453-5e706d679350	2d567e35-cfd0-4a00-8f9b-7dd8522f313a	5	I can use constraint  tools to specify a 2D sketch.	2	t
040ee0f2-9508-42ea-980f-77b63f8d1d59	2d567e35-cfd0-4a00-8f9b-7dd8522f313a	5	I can use variables to ensure my sketches are flexible.	3	t
d871a50a-fea8-4ee9-bd85-eeedeac32e38	9abe4247-d57b-4fcb-a067-165efeaf4849	5	I can use Autolayout to export shapes to .DXF file	3	t
9a0f7cd1-75b5-4979-91d3-3b4d2a53d001	9abe4247-d57b-4fcb-a067-165efeaf4849	5	I can use Laser Tool to automatically joint shapes.	2	t
82c37fd3-6b7f-4cdc-a37a-67b83e0741b8	58f3ebe0-eaa3-48e7-941f-48ce961ede46	3	I can create a flat prototype of a design.	0	t
9975d1de-864a-4175-861b-ffa70938efbd	63f8d18c-c47b-4217-8e6b-0e18644dcd6b	1	I can colour a sketch	1	t
e02cecb6-8178-4a08-8698-432a566f922d	63f8d18c-c47b-4217-8e6b-0e18644dcd6b	2	I can outline an image	0	t
764fe552-e23b-47d2-9014-8647bd517752	63f8d18c-c47b-4217-8e6b-0e18644dcd6b	2	I can annotate a sketch	2	t
5c19a3bb-1295-4c8d-a1bc-e89108d555d8	852f8779-6a5e-4fff-9f53-6cba0dc138f3	5	New success criterion	0	t
0c161717-84a3-488b-9588-0cd19418fd0a	ca58a8a2-dddd-4842-b799-3cb52bf5ae09	5	I can model a 6 sided box	4	t
f6838e26-11b8-4918-9eec-3f880078d6a6	5503e8d3-e6b0-4bd3-9459-ee526a334cbb	4	I can use the laser joint tool	0	t
f52b9adc-80cd-47d1-ac56-4289ee6beb65	5503e8d3-e6b0-4bd3-9459-ee526a334cbb	4	I can use the automtic layout to position parts for extraction	1	t
\.


--
-- Data for Name: success_criteria_units; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."success_criteria_units" ("success_criteria_id", "unit_id") FROM stdin;
f53315cb-f3b0-4328-8133-1f2c91f91bfe	701-ISOMETRIC-SKETCHING
37fccff6-414c-463c-8d20-68489df1e0f3	701-ISOMETRIC-SKETCHING
83b146f2-718e-4bc7-bbbc-73382cb05575	701-ISOMETRIC-SKETCHING
be239da2-aad5-4b97-951c-2ef1548752c1	701-ISOMETRIC-SKETCHING
f9966d00-d4a0-43b1-add4-6e4201ffe96b	701-ISOMETRIC-SKETCHING
b59cca57-9e74-4a95-ad37-5db8c3383ebc	701-ISOMETRIC-SKETCHING
c6027ce2-2cb1-427e-8130-81ed9fac5d93	701-ISOMETRIC-SKETCHING
581aa31f-1c68-4599-9bfd-268185ec46ee	10-2-ONSHAPE-BASIC-SKILLS
7de602d1-30dd-481f-84c2-a427345db200	10-2-ONSHAPE-BASIC-SKILLS
2e92cb9a-55be-40f1-bede-76e16e008711	10-2-ONSHAPE-BASIC-SKILLS
8869391e-d6e2-45f2-a6fd-74bf2b400ddb	10-2-ONSHAPE-BASIC-SKILLS
e6434c7d-7d8d-42dd-99ff-57980bd7a8fd	10-2-ONSHAPE-BASIC-SKILLS
67cbf83f-0749-4373-aa94-eda7221363d5	10-2-ONSHAPE-BASIC-SKILLS
fa9fc3d7-d789-4aef-b4d9-afc48fa628e3	INDUCTION
32c9e025-e8ad-4d50-b25c-c59d2524b0cd	INDUCTION
6bfdf9bd-d381-4313-b4b3-d0c6d1968a48	INDUCTION
aa06118e-5353-4e77-98f3-cf2192620d0b	UNIT004
dded71d8-39cb-4578-87f4-9fa77cf0130d	UNIT004
efe4345e-4535-4a8d-8aa7-c55885ca64ff	UNIT004
f98d2a4a-bc17-4b83-a7e8-4a8b0a8dc4aa	UNIT004
7d9d3211-113e-4961-a536-84f3baa51028	UNIT004
54b4e504-7bd3-4133-8d20-39b1ee29181d	DT-INDUCTION
5f2b7707-db53-4b6f-9890-fa65f9154e6d	DT-INDUCTION
5ce786a4-2aff-475d-9d50-e06ebc06a94a	801-CANDLE-HOLDER
c6e5c2f7-ed7c-4237-8730-d6de7fcf4cfc	DT-INDUCTION-KS4
fe348aa8-b36c-4d26-8414-3ee7f4978188	801-CANDLE-HOLDER
9f02d427-7792-4cfe-aadb-8fefe86a40d0	801-CANDLE-HOLDER
279542cb-7139-467a-9cc3-0dda362fe8aa	801-CANDLE-HOLDER
37864689-b68e-4958-810e-0492af84cec9	801-CANDLE-HOLDER
07a38c75-be31-4f22-a453-a66b48960543	801-CANDLE-HOLDER
ba323877-7a98-4982-8be5-a1b9dcf6798e	801-CANDLE-HOLDER
ce902b80-be18-421a-9d94-eb89a421dc4e	1001-CORE-1
23aff4ff-3ac3-489c-b367-eff501874058	1001-CORE-1
f16aac2d-8f8d-48a6-9b87-6bfa840ec83e	1001-CORE-1
77ceb96f-a565-45c4-a281-70b8c343e301	1001-CORE-1
527f8fda-25bd-4e43-a05c-5afea854c611	1001-CORE-1
2841d457-13a8-471d-8d70-1f0c9c27a3c5	1001-CORE-1
045f3f7f-333c-4b95-8d81-3d6e3d7ce2ba	1001-CORE-1
ec4cda64-e023-4b52-afea-1d9b6b7bbc85	1001-CORE-1
c8961004-5a52-44a6-b1bc-8c3efb317836	1001-CORE-1
94114476-fc82-4d34-828f-317e8a24112d	1001-CORE-1
9acea059-2bca-4478-b2e1-4343f225da5d	1001-CORE-1
8a75d83a-970c-45ca-b7da-b4371d11de10	1001-CORE-1
e52fe58d-739b-4607-94ee-8a3af2674498	1001-CORE-1
81055c31-0b34-45db-a298-c0e87f09569d	1001-CORE-1
bd0c1b0e-26d4-4447-8dde-2d068014ba50	10-2-ONSHAPE-BASIC-SKILLS
6a80e5fd-6735-4209-ba87-34d3da28ecc3	10-2-ONSHAPE-BASIC-SKILLS
c908b6c5-2ec4-4b2c-be71-f0830d491c0b	801-CANDLE-HOLDER
35e08f34-9ec9-4c9c-9062-2524ee4f984d	801-CANDLE-HOLDER
35e08f34-9ec9-4c9c-9062-2524ee4f984d	UNIT004
757f57b4-588d-4941-b3a6-f739106d3be3	10-01-ICT-DIGITAL-DEVICES
620b8d0b-e0a4-4d4d-aafe-584eaab3f296	10-01-ICT-DIGITAL-DEVICES
fc3da2a7-1de3-4f21-88e0-e74d5f3ba83e	10-01-ICT-DIGITAL-DEVICES
\.


--
-- Name: feedback_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."feedback_id_seq"', 810, true);


--
-- PostgreSQL database dump complete
--

-- \unrestrict x4Mqw7c7YZU3nagajpWsZuLg2tvNyq1oJfDa2KIYG9dWNGAPc9J0iLCSGxn9loP

RESET ALL;
