# PDF Preview

## Overview

The **PDF Preview** node displays PDF documents with download capability. It supports URLs, blob URLs, and base64-encoded PDFs up to 20MB, making it ideal for viewing PDF reports, documents, and files within workflows.

## Category

**Widget**

## Parameters

### pdfSource

- **Type**: String (textarea)
- **Required**: Yes
- **Description**: PDF source
- **Supported Formats**:
  - URL (http:// or https://)
  - Blob URL (blob://)
  - Base64 data (data:application/pdf;base64,...)
- **Features**: Supports drag & drop of .pdf files
- **Size Limit**: Up to 20MB

## Outputs

### success

- **Type**: Boolean
- **Description**: Whether the PDF was successfully processed

### pdfUrl

- **Type**: String
- **Description**: The PDF URL ready for rendering

### metadata

- **Type**: Object
- **Description**: PDF metadata including:
  - Source type (url, blob, base64)
  - File size in bytes
  - Page count (when available)

### error

- **Type**: String
- **Description**: Error message if PDF processing failed

## Use Cases

1. **Report Viewing**: Display generated PDF reports
2. **Document Preview**: Preview PDF documents before processing
3. **Invoice Display**: Show PDF invoices from APIs
4. **Contract Review**: Display PDF contracts for review
5. **Receipt Generation**: Preview generated receipts
6. **Documentation**: Display PDF documentation files

## Example Configurations

**Display PDF from URL**

```
pdfSource: https://example.com/document.pdf
```

**Display Base64 PDF**

```
pdfSource: data:application/pdf;base64,JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC...
```

**Display Generated PDF**

```
pdfSource: {{pdfGenerator.pdfUrl}}
```

## Tips

- Maximum file size is 20MB for performance
- Base64 PDFs are automatically converted to blob URLs for rendering
- Supports download functionality for all PDF sources
- Metadata includes page count when available
- Works with both local and remote PDF sources
- Drag & drop support for easy file upload

## Common Patterns

**Report Generation Workflow**

```
1. Generate data with API calls
2. Create PDF report with external service
3. Display with PDF Preview
4. Allow user to download
```

**Invoice Processing**

```
1. Fetch invoice PDF from API
2. Display with PDF Preview
3. Extract data if needed
4. Store or email the invoice
```

**Document Approval Flow**

```
1. Upload PDF document
2. Display with PDF Preview for review
3. Use conditional logic for approval
4. Process based on decision
```

## Related Nodes

- **Custom API Request**: For fetching PDFs from APIs
- **File System Operation**: For reading local PDF files
- **Send Email**: For emailing PDFs
- **Media Preview**: For displaying images
- **HTML Preview**: For displaying HTML content

## Tags

pdf, preview, document, display, widget, file, report, invoice
