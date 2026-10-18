import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Divider,
  Paper,
  Link,
} from '@mui/material';
import LegalBackButton from './LegalBackButton';

const TermsOfService = () => {
  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <LegalBackButton />

      <Paper elevation={2} sx={{ p: { xs: 3, md: 5 } }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Terms of Service
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Last updated: March 2026
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Applies to: CPR Training Portal at{' '}
          <Link href="https://cpr.kpbc.ca" target="_blank" rel="noopener noreferrer">
            https://cpr.kpbc.ca
          </Link>
          {' '}operated by KPBC.
        </Typography>

        <Divider sx={{ my: 3 }} />

        {/* Section 1 */}
        <Typography variant="h6" component="h2" gutterBottom>
          1. Acceptance of Terms
        </Typography>
        <Typography variant="body1" paragraph>
          By accessing or using the CPR Training Portal ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service. These Terms apply to all users, including organization administrators, instructors, and students.
        </Typography>

        <Divider sx={{ my: 3 }} />

        {/* Section 2 */}
        <Typography variant="h6" component="h2" gutterBottom>
          2. Description of Service
        </Typography>
        <Typography variant="body1" paragraph>
          The CPR Training Portal is a software-as-a-service platform that enables organizations to manage CPR training courses, schedule instructors, track student attendance, and handle billing and invoicing. Access to the Service is granted on a per-organization basis by KPBC.
        </Typography>

        <Divider sx={{ my: 3 }} />

        {/* Section 3 */}
        <Typography variant="h6" component="h2" gutterBottom>
          3. Account Responsibilities
        </Typography>
        <Typography variant="body1" paragraph>
          You are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account. You must:
        </Typography>
        <Box component="ul" sx={{ pl: 3, mb: 2 }}>
          <Box component="li" sx={{ mb: 0.5 }}>
            <Typography variant="body1">Provide accurate and complete information when your account is created</Typography>
          </Box>
          <Box component="li" sx={{ mb: 0.5 }}>
            <Typography variant="body1">Notify your organization administrator or KPBC immediately of any unauthorized use of your account</Typography>
          </Box>
          <Box component="li" sx={{ mb: 0.5 }}>
            <Typography variant="body1">Not share your login credentials with any other person</Typography>
          </Box>
          <Box component="li" sx={{ mb: 0.5 }}>
            <Typography variant="body1">Use the Service only for lawful purposes and in accordance with these Terms</Typography>
          </Box>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Section 4 */}
        <Typography variant="h6" component="h2" gutterBottom>
          4. Fees and Payment
        </Typography>
        <Typography variant="body1" paragraph>
          Access to the Service is subject to fees as agreed between your organization and KPBC. Invoices are issued through the platform and are payable within 30 days of the invoice date unless otherwise agreed in writing. Overdue accounts may be subject to a monthly service charge of 1.5% and suspension of access until outstanding amounts are resolved.
        </Typography>
        <Typography variant="body1" paragraph>
          All fees are in Canadian dollars (CAD) unless otherwise stated. KPBC reserves the right to update pricing with 30 days' written notice to organization administrators.
        </Typography>

        <Divider sx={{ my: 3 }} />

        {/* Section 5 */}
        <Typography variant="h6" component="h2" gutterBottom>
          5. Data Ownership and Privacy
        </Typography>
        <Typography variant="body1" paragraph>
          Your organization retains ownership of all data entered into the Service, including course records, student information, and billing data ("Your Data"). KPBC processes Your Data solely to provide the Service and does not sell or share it with unaffiliated third parties.
        </Typography>
        <Typography variant="body1" paragraph>
          Our collection and use of personal information is governed by our{' '}
          <Link component={RouterLink} to="/privacy">
            Privacy Policy
          </Link>
          , which is incorporated into these Terms by reference.
        </Typography>

        <Divider sx={{ my: 3 }} />

        {/* Section 6 */}
        <Typography variant="h6" component="h2" gutterBottom>
          6. Cancellation and Offboarding
        </Typography>
        <Typography variant="body1" paragraph>
          Either party may terminate the service arrangement with 30 days' written notice. Upon termination:
        </Typography>
        <Box component="ul" sx={{ pl: 3, mb: 2 }}>
          <Box component="li" sx={{ mb: 0.5 }}>
            <Typography variant="body1">All outstanding invoices become immediately due and payable</Typography>
          </Box>
          <Box component="li" sx={{ mb: 0.5 }}>
            <Typography variant="body1">Your organization's data will remain accessible for 30 days after the termination date, during which you may request an export of your data</Typography>
          </Box>
          <Box component="li" sx={{ mb: 0.5 }}>
            <Typography variant="body1">After 30 days, user accounts will be deactivated and personal data will be anonymised or deleted in accordance with our Privacy Policy and applicable retention requirements</Typography>
          </Box>
          <Box component="li" sx={{ mb: 0.5 }}>
            <Typography variant="body1">Course attendance records and financial records required for regulatory compliance will be retained for the periods specified in our Privacy Policy</Typography>
          </Box>
        </Box>
        <Typography variant="body1" paragraph>
          To request a data export or initiate termination, contact KPBC at the address below.
        </Typography>

        <Divider sx={{ my: 3 }} />

        {/* Section 7 */}
        <Typography variant="h6" component="h2" gutterBottom>
          7. Acceptable Use
        </Typography>
        <Typography variant="body1" paragraph>
          You may not use the Service to:
        </Typography>
        <Box component="ul" sx={{ pl: 3, mb: 2 }}>
          <Box component="li" sx={{ mb: 0.5 }}>
            <Typography variant="body1">Upload or transmit any content that is unlawful, harmful, or infringes third-party rights</Typography>
          </Box>
          <Box component="li" sx={{ mb: 0.5 }}>
            <Typography variant="body1">Attempt to gain unauthorized access to any part of the Service or other users' accounts</Typography>
          </Box>
          <Box component="li" sx={{ mb: 0.5 }}>
            <Typography variant="body1">Interfere with or disrupt the integrity or performance of the Service</Typography>
          </Box>
          <Box component="li" sx={{ mb: 0.5 }}>
            <Typography variant="body1">Use automated means to scrape, copy, or extract data from the Service without prior written consent</Typography>
          </Box>
        </Box>
        <Typography variant="body1" paragraph>
          KPBC reserves the right to suspend or terminate access for any user or organization found to be in violation of these restrictions.
        </Typography>

        <Divider sx={{ my: 3 }} />

        {/* Section 8 */}
        <Typography variant="h6" component="h2" gutterBottom>
          8. Service Availability
        </Typography>
        <Typography variant="body1" paragraph>
          KPBC will make reasonable efforts to maintain the availability of the Service but does not guarantee uninterrupted or error-free operation. Scheduled maintenance will be communicated in advance where possible. KPBC is not liable for any loss or damage resulting from downtime, service interruptions, or data inaccessibility.
        </Typography>

        <Divider sx={{ my: 3 }} />

        {/* Section 9 */}
        <Typography variant="h6" component="h2" gutterBottom>
          9. Limitation of Liability
        </Typography>
        <Typography variant="body1" paragraph>
          To the fullest extent permitted by applicable law, KPBC's total liability to your organization arising from or related to these Terms or the Service shall not exceed the total fees paid by your organization in the three months preceding the event giving rise to the claim. KPBC is not liable for indirect, incidental, special, or consequential damages of any kind.
        </Typography>

        <Divider sx={{ my: 3 }} />

        {/* Section 10 */}
        <Typography variant="h6" component="h2" gutterBottom>
          10. Changes to These Terms
        </Typography>
        <Typography variant="body1" paragraph>
          KPBC may update these Terms from time to time. Organization administrators will be notified of material changes by email at least 14 days before they take effect. Continued use of the Service after the effective date constitutes acceptance of the updated Terms.
        </Typography>

        <Divider sx={{ my: 3 }} />

        {/* Section 11 */}
        <Typography variant="h6" component="h2" gutterBottom>
          11. Governing Law
        </Typography>
        <Typography variant="body1" paragraph>
          These Terms are governed by the laws of the Province of Ontario and the federal laws of Canada applicable therein. Any disputes arising under these Terms shall be subject to the exclusive jurisdiction of the courts of Ontario.
        </Typography>

        <Divider sx={{ my: 3 }} />

        {/* Section 12 */}
        <Typography variant="h6" component="h2" gutterBottom>
          12. Contact
        </Typography>
        <Typography variant="body1" paragraph>
          For questions about these Terms, to request a data export, or to initiate account termination, contact:
        </Typography>
        <Box sx={{ pl: 2, borderLeft: 3, borderColor: 'primary.main', mb: 2 }}>
          <Typography variant="body1">
            <strong>KPBC</strong>
          </Typography>
          <Typography variant="body1">
            Email:{' '}
            <Link href="mailto:admin@kpbc.ca">
              admin@kpbc.ca
            </Link>
          </Typography>
          <Typography variant="body1">
            Service: CPR Training Portal — https://cpr.kpbc.ca
          </Typography>
        </Box>

        <Divider sx={{ my: 3 }} />

        <Typography variant="body2" color="text.secondary">
          These Terms of Service were last updated in March 2026. The date at the top of this page reflects the most recent revision.
        </Typography>
      </Paper>
    </Container>
  );
};

export default TermsOfService;
