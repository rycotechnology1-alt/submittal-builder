# Phase 0 Sample PDFs

These PDFs are required to complete the spikes in Phase 0 of the build plan (`step-8-buildplan.md`).

### 1. Text-Native Cut Sheet (HVAC)
**URL:** [Daikin VRV Outdoor Unit Submittal (PDF)](https://files.hvacnavigator.com/p/(h,y)vahr072b31s%20submittal.pdf)
**Description:** A manufacturer-provided Submittal Data Sheet for a Daikin VRV HVAC system. This is a text-native PDF filled with technical specifications, capacity ratings, and dimensional drawings, making it perfect for testing `pdfjs-dist` text extraction and Claude's ability to pull out specific model numbers and attributes.

### 2. Scanned / Sample Warranty Document
**URL:** [James Hardie Lap Siding Warranty (PDF)](https://www.buildsite.com/pdf/jameshardie/HardiePlank-Lap-Siding-Warranty-2905085.pdf)
**Description:** A standard 30-year limited product warranty document. This represents a typical closeout/warranty submittal, testing the OCR pipeline (via Textract) and document classification logic to identify it as a warranty document.

### 3. Engineering Shop Drawing
**URL:** [Woodwork Institute Sample Shop Drawings (PDF)](https://woodworkinstitute.com/wp-content/uploads/2014/12/ShopDrawingSample_revised.pdf)
**Description:** A comprehensive 26-page set of sample shop drawings that includes floor plans, sections, elevations, and joinery details. Shop drawings are typically the most complex PDFs in a submittal package, providing an excellent stress test for `pdf-lib` (to ensure it doesn't choke or corrupt the file when merging or Bates stamping) and testing the `qpdf` fallback strategy outlined in the build plan.
