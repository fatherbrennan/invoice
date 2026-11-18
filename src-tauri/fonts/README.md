# PDF fonts

Invoice embeds IBM Plex Sans Regular and SemiBold, using only the glyphs needed
by each document. The app interface uses operating-system fonts.

The unmodified TTFs come from IBM Plex commit
`bc6a7e4b37634eb79785d59781893db63ee3edcb`, under
`packages/plex-sans/fonts/complete/ttf`.

| File | SHA-256 |
| --- | --- |
| IBMPlexSans-Regular.ttf | `b47ebd72b5ce53b60f909033ff84d6fc12358cc147e2981f8c321ad3f36246b6` |
| IBMPlexSans-SemiBold.ttf | `c51119b25f4a296da2b66edf3201b9aa1735091ed7efc1fca0313346f3851a4d` |

The copyright and SIL Open Font License 1.1 notice is retained in
`IBMPlexSans-OFL.txt`, copied into `static/licenses`, included in package resources
and displayed in Settings / Data. Subsetter, PDF.js and Valibot notices are also
provided there. `scripts/fonts.test.mjs` checks font hashes, embedding flags and
licence packaging.

The PDF renderer subsets and compresses fonts, preserves Unicode text extraction,
and writes compressed object and cross-reference streams. No installed PDF font
or external conversion program is required. Unsupported characters cause a
visible error before issuance. These are ordinary PDFs, with no PDF/A or PDF/X
claim.
