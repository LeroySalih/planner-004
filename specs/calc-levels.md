# Calculating Levels

This file describes how to calculate a current level.

A level is a conversion of the percentage to the standard school reporting system.

The Level Boundaries are different for each year of the pupil.  The first row is the pupil year.  The first column is the level that will be awarded.

Levels are based on the assessment/summative score, not the total score.
Levels are only applied to the unit, no other layer of thehierachy calculates a level.

### Level Boundary Table
Level id	7	8	9	10   11
0	0	0	0	0	0	0
1L	1	6	6	5	4	4
1M	2	11	11	10	8	7
1H	3	17	17	14	12	11
2L	4	22	22	19	16	14
2M	5	33	28	24	20	18
2H	6	40	33	29	24	21
3L	7	47	39	33	28	25
3M	8	53	44	38	32	29
3H	9	60	50	43	36	32
4L	10	67	56	48	40	36
4M	11	73	61	52	44	39
4H	12	80	67	57	48	43
5L	13	87	72	62	52	46
5M	14	93	78	67	56	50
5H	15		83	71	60	54
6L	16		89	76	64	57
6M	17		94	81	68	61
6H	18			86	72	64
7L	19			90	76	68
7M	20			95	80	71
7H	21				84	75
8L	22				88	79
8M	23				92	82
8H	24				96	86
9L	25					89
9M	26					93
9H	27					96


### Examples
A year 7 pupil that scores 54% will be awarded a 3M
A year 8 pupil that scores 73% will be awarded a 5L

### Implementation Notes
- Level thresholds are codified in `src/lib/levels/index.ts`. Update that helper when these boundaries change so all reports stay in sync.
- Call `getLevelForYearScore(year, summativeAverage)` with a summative score (0–1 or 0–100); it returns the correct level string or `null` when no mapping exists.
