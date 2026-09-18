import React, { useState, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  CircularProgress,
  FormControlLabel,
  Switch,
  Autocomplete,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
const Editor = React.lazy(() => import('@monaco-editor/react'));
import { emailTemplateApi } from '../../../services/api';
import { useToast } from '../../../contexts/ToastContext';
import StatusChip from '../../gtacpr/StatusChip';
import DataTable, { DataTableRow } from '../../gtacpr/DataTable';
import SearchBar from '../../gtacpr/SearchBar';
import { PrimaryButton, GhostButton } from '../../gtacpr/Buttons';
import { useConfirm } from '../../gtacpr/ConfirmDialog';
import { getErrorMessage } from '../../../utils/errorMessage';

interface EmailTemplate {
  id?: number;
  name: string;
  key: string;
  subject: string;
  htmlContent: string;
  body?: string;
  textContent?: string;
  description?: string;
  category:
    | 'Instructor'
    | 'Organization'
    | 'Course Admin'
    | 'Accountant'
    | 'Sys Admin'
    | 'Other';
  subCategory?: string;
  eventTriggers: string[];
  availableVariables: Array<{
    name: string;
    description: string;
    sampleValue: string;
  }>;
  isActive: boolean;
  isSystem: boolean;
  createdBy?: {
    firstName: string;
    lastName: string;
  };
  lastModifiedBy?: {
    firstName: string;
    lastName: string;
  };
  usageCount?: number;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

interface EventTrigger {
  value: string;
  label: string;
  category: string;
}

interface TemplateVariable {
  name: string;
  description: string;
  sampleValue: string;
}

type EditorMode = 'rich' | 'html' | 'simple';
type ViewMode = 'grid' | 'table';

const categoryOptions: Record<string, string[]> = {
  Instructor: ['On-boarding', 'Course Confirmed'],
  Organization: ['Course Confirmed', 'Invoice sent'],
  'Course Admin': [],
  Accountant: [],
  'Sys Admin': [],
  Other: [],
};

const sectionHeaderSx = {
  fontSize: 13,
  fontWeight: 700,
  color: (theme: Theme) => theme.palette.text.secondary,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.07em',
};

const dialogTitleSx = {
  fontSize: 18,
  fontWeight: 700,
  color: (theme: Theme) => theme.palette.text.primary,
};

const tableColumns = [
  { key: 'name', label: 'Name', width: '2fr' },
  { key: 'category', label: 'Category', width: '1.5fr' },
  { key: 'subject', label: 'Subject', width: '2fr' },
  { key: 'updated', label: 'Last Updated', width: '1.5fr' },
  { key: 'status', label: 'Status', width: '1.5fr' },
  { key: 'actions', label: 'Actions', width: '2fr' },
];

const actionLinkSx = {
  fontSize: 12,
  fontWeight: 600,
  color: '#CC1F1F',
  cursor: 'pointer',
  '&:hover': { textDecoration: 'underline' },
};

const EmailTemplateManager: React.FC = () => {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('rich');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<string>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [eventTriggers, setEventTriggers] = useState<EventTrigger[]>([]);
  const [commonVariables, setCommonVariables] = useState<TemplateVariable[]>([]);
  const [testEmail, setTestEmail] = useState('');
  const [previewVariables, setPreviewVariables] = useState<Record<string, string>>({});
  const { showToast } = useToast();

  const [formData, setFormData] = useState<EmailTemplate>({
    name: '',
    key: '',
    subject: '',
    htmlContent: '',
    textContent: '',
    description: '',
    category: 'Other',
    subCategory: '',
    eventTriggers: [],
    availableVariables: [],
    isActive: true,
    isSystem: false,
  });

  const fetchTemplates = useCallback(async (
    currentCategoryFilter?: string,
    currentSearchTerm?: string
  ) => {
    setLoading(true);
    try {
      const effectiveCategoryFilter =
        currentCategoryFilter !== undefined ? currentCategoryFilter : categoryFilter;
      const effectiveSearchTerm =
        currentSearchTerm !== undefined ? currentSearchTerm : searchTerm;

      try {
        const params: Record<string, string> = { active: 'true' };
        if (effectiveCategoryFilter !== 'all') {
          params.category = effectiveCategoryFilter;
        }
        if (effectiveSearchTerm) {
          params.search = effectiveSearchTerm;
        }

        const response = await emailTemplateApi.getAll(params);
        const rawTemplates = response.data.templates || response.data.data || [];

        const mappedTemplates = rawTemplates.map((t: Record<string, unknown>) => ({
          ...t,
          htmlContent: t.htmlContent || t.body,
          eventTriggers: t.eventTriggers || [],
          availableVariables: t.availableVariables || [],
        }));

        setTemplates(mappedTemplates);
      } catch (error: unknown) {
        console.error('[EmailTemplateManager] Error fetching templates:', error);
        showToast({ type: 'error', message: 'Failed to fetch templates', priority: 'normal' });
      }
    } catch (outerError) {
      console.error('[EmailTemplateManager] Unexpected error in fetchTemplates:', outerError);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, searchTerm, showToast]);

  const fetchMetadata = useCallback(async () => {
    try {
      const [triggersResponse, variablesResponse] = await Promise.all([
        emailTemplateApi.getEventTriggers(),
        emailTemplateApi.getTemplateVariables(),
      ]);
      setEventTriggers(triggersResponse.data.data || triggersResponse.data);
      setCommonVariables(variablesResponse.data.data || variablesResponse.data);
    } catch (error: unknown) {
      console.error('[EmailTemplateManager] Error fetching metadata:', error);
      showToast({
        type: 'error',
        message: 'Failed to fetch template metadata.',
        priority: 'normal',
      });
    }
  }, [showToast]);

  useEffect(() => {
    fetchTemplates('all', '').catch(error => {
      console.error('[EmailTemplateManager] Error loading templates:', error);
      showToast({
        type: 'error',
        message: 'Failed to load email templates on initial load.',
        priority: 'normal',
      });
    });
    fetchMetadata().catch(error => {
      console.error('[EmailTemplateManager] Error loading metadata:', error);
      showToast({
        type: 'error',
        message: 'Failed to load template metadata.',
        priority: 'normal',
      });
    });
    // Intentionally run once on mount only; the filter-driven effect below handles refetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchTemplates(categoryFilter, searchTerm).catch(error => {
      console.error('[EmailTemplateManager] Error refetching templates:', error);
      showToast({
        type: 'error',
        message: 'Failed to refetch templates after filter change.',
        priority: 'normal',
      });
    });
  }, [categoryFilter, searchTerm, fetchTemplates, showToast]);

  const handleCreateTemplate = () => {
    setSelectedTemplate(null);
    setFormData({
      name: '',
      key: '',
      subject: '',
      htmlContent: '',
      textContent: '',
      description: '',
      category: 'Other',
      subCategory: '',
      eventTriggers: [],
      availableVariables: [],
      isActive: true,
      isSystem: false,
    });
    setEditDialogOpen(true);
  };

  const handleEditTemplate = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setFormData({
      ...template,
      htmlContent: template.htmlContent || template.body || '',
      eventTriggers: template.eventTriggers || [],
      availableVariables: template.availableVariables || [],
    });
    setEditDialogOpen(true);
  };

  const handleSaveTemplate = async () => {
    try {
      if (selectedTemplate?.id) {
        await emailTemplateApi.update(selectedTemplate.id, formData);
        showToast({
          type: 'success',
          message: 'Template updated successfully!',
          priority: 'normal',
        });
      } else {
        await emailTemplateApi.create(formData);
        showToast({
          type: 'success',
          message: 'Template created successfully!',
          priority: 'normal',
        });
      }
      setEditDialogOpen(false);
      fetchTemplates(categoryFilter, searchTerm);
    } catch (error: unknown) {
      console.error('Error saving template:', error);
      showToast({
        type: 'error',
        message: getErrorMessage(error, 'Failed to save template'),
        priority: 'normal',
      });
    }
  };

  const handleDeleteTemplate = async (templateId: number) => {
    const target = templates.find((t) => t.id === templateId);
    const ok = await confirm({
      title: 'Delete email template?',
      message: `${target?.name || 'This template'} will be deleted. Emails that use it will fall back to the default. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) {
      try {
        await emailTemplateApi.delete(templateId);
        fetchTemplates(categoryFilter, searchTerm);
        showToast({
          type: 'success',
          message: 'Template deleted successfully!',
          priority: 'normal',
        });
      } catch (error: unknown) {
        console.error('Error deleting template:', error);
        showToast({
          type: 'error',
          message: getErrorMessage(error, 'Failed to delete template'),
          priority: 'normal',
        });
      }
    }
  };

  const handleCloneTemplate = async (templateId: number, newName: string) => {
    try {
      await emailTemplateApi.clone(templateId, newName);
      fetchTemplates(categoryFilter, searchTerm);
      showToast({
        type: 'success',
        message: `Template cloned successfully as "${newName}"!`,
        priority: 'normal',
      });
    } catch (error: unknown) {
      console.error('Error cloning template:', error);
      showToast({
        type: 'error',
        message: getErrorMessage(error, 'Failed to clone template'),
        priority: 'normal',
      });
    }
  };

  const handlePreviewTemplate = async (template: EmailTemplate) => {
    setSelectedTemplate(template);
    const variables: Record<string, string> = {};
    template.availableVariables.forEach(v => {
      variables[v.name] = v.sampleValue;
    });
    setPreviewVariables(variables);
    setPreviewDialogOpen(true);
  };

  const handleTestEmail = async () => {
    if (!selectedTemplate) return;
    try {
      await emailTemplateApi.sendTest(selectedTemplate.id!, testEmail, previewVariables);
      showToast({
        type: 'success',
        message: `Test email sent to ${testEmail}`,
        priority: 'normal',
      });
      setTestDialogOpen(false);
    } catch (error: unknown) {
      console.error('Error sending test email:', error);
      showToast({
        type: 'error',
        message: getErrorMessage(error, 'Failed to send test email'),
        priority: 'normal',
      });
    }
  };

  const handleColumnSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const getSortIcon = (column: string) => {
    if (sortBy !== column) return '';
    return sortOrder === 'asc' ? ' ↑' : ' ↓';
  };

  const convertToHtml = (text: string): string => {
    return text
      .split('\n\n')
      .map(paragraph => {
        if (paragraph.trim().startsWith('- ')) {
          const items = paragraph
            .split('\n')
            .map(item => `<li>${item.replace('- ', '')}</li>`)
            .join('');
          return `<ul>${items}</ul>`;
        }
        return `<p>${paragraph}</p>`;
      })
      .join('\n')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  };

  const renderTemplateCard = (template: EmailTemplate) => (
    <Box
      key={template.id}
      sx={{
        border: (theme: Theme) => `1px solid ${theme.palette.divider}`,
        borderRadius: '8px',
        p: 2.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          mb: 2,
        }}
      >
        <Box>
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: (theme) => theme.palette.text.primary, mb: 0.5 }}>
            {template.name}
          </Typography>
          <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary, mb: 1 }}>
            {template.description}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          <StatusChip kind="brand" label={template.category} />
          {template.subCategory && (
            <StatusChip kind="neutral" label={template.subCategory} />
          )}
          {template.isSystem && <StatusChip kind="warning" label="System" />}
          <StatusChip
            kind={template.isActive ? 'success' : 'inactive'}
            label={template.isActive ? 'Active' : 'Inactive'}
          />
        </Box>
      </Box>

      {template.eventTriggers.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography sx={{ ...sectionHeaderSx, fontSize: 11, mb: 0.5 }}>
            Event Triggers:
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
            {template.eventTriggers.map(trigger => (
              <StatusChip
                key={trigger}
                kind="neutral"
                label={
                  eventTriggers.find(et => et.value === trigger)?.label || trigger
                }
              />
            ))}
          </Box>
        </Box>
      )}

      <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
        Subject: {template.subject}
      </Typography>
      {template.updatedAt && (
        <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mt: 1 }}>
          Updated: {new Date(template.updatedAt).toLocaleDateString()}
        </Typography>
      )}

      <Box sx={{ mt: 'auto', pt: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <Box
          onClick={() => handleEditTemplate(template)}
          sx={actionLinkSx}
        >
          {template.isSystem ? 'Edit System' : 'Edit'}
        </Box>
        {!template.isSystem && (
          <Box
            onClick={() => handleDeleteTemplate(template.id!)}
            sx={actionLinkSx}
          >
            Delete
          </Box>
        )}
        <Box
          onClick={() => handleCloneTemplate(template.id!, `${template.name} (Copy)`)}
          sx={actionLinkSx}
        >
          Clone
        </Box>
        <Box
          onClick={() => handlePreviewTemplate(template)}
          sx={actionLinkSx}
        >
          Preview
        </Box>
        <Box
          onClick={() => {
            setSelectedTemplate(template);
            setTestDialogOpen(true);
          }}
          sx={actionLinkSx}
        >
          Send Test
        </Box>
      </Box>
    </Box>
  );

  const filteredTemplates = templates.filter(template => {
    if (categoryFilter !== 'all' && template.category !== categoryFilter) {
      return false;
    }
    if (
      searchTerm &&
      !template.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !(template.description || '').toLowerCase().includes(searchTerm.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const sortedTemplates = [...filteredTemplates].sort((a, b) => {
    let comparison = 0;
    const valA = a[sortBy as keyof EmailTemplate];
    const valB = b[sortBy as keyof EmailTemplate];

    if (typeof valA === 'string' && typeof valB === 'string') {
      comparison = valA.localeCompare(valB);
    } else if (typeof valA === 'boolean' && typeof valB === 'boolean') {
      comparison = valA === valB ? 0 : valA ? -1 : 1;
    } else if (valA instanceof Date && valB instanceof Date) {
      comparison = valA.getTime() - valB.getTime();
    }

    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const editorModes: { value: EditorMode; label: string }[] = [
    { value: 'rich', label: 'Rich Text' },
    { value: 'html', label: 'HTML' },
    { value: 'simple', label: 'Simple' },
  ];

  const viewModes: { value: ViewMode; label: string }[] = [
    { value: 'grid', label: 'Grid' },
    { value: 'table', label: 'Table' },
  ];

  return (
    <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '8px', p: 3, mt: 3 }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
        }}
      >
        <Typography sx={{ fontSize: 18, fontWeight: 700, color: (theme) => theme.palette.text.primary }}>
          Email Template Manager
        </Typography>
        <PrimaryButton onClick={handleCreateTemplate}>+ Create Template</PrimaryButton>
      </Box>

      <Box sx={{ mb: 3, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Box sx={{ flexGrow: 1 }}>
          <SearchBar
            value={searchTerm}
            onChange={v => setSearchTerm(v)}
            placeholder="Search templates..."
          />
        </Box>
        <FormControl variant="outlined" size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Category</InputLabel>
          <Select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value as string)}
            label="Category"
          >
            <MenuItem value="all">All Categories</MenuItem>
            {Object.keys(categoryOptions).map(cat => (
              <MenuItem key={cat} value={cat}>
                {cat}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ display: 'flex', border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '8px', overflow: 'hidden' }}>
          {viewModes.map(mode => (
            <Box
              key={mode.value}
              onClick={() => setViewMode(mode.value)}
              sx={{
                px: 2,
                py: 0.5,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                borderRadius: '6px',
                bgcolor: viewMode === mode.value ? '#CC1F1F' : 'transparent',
                color: viewMode === mode.value ? '#fff' : (theme) => theme.palette.text.secondary,
                transition: 'background-color 0.15s, color 0.15s',
              }}
            >
              {mode.label}
            </Box>
          ))}
        </Box>
      </Box>

      <Box sx={{ p: 2, bgcolor: (theme) => theme.palette.background.default, borderRadius: 1, mb: 2, border: (theme) => `1px solid ${theme.palette.divider}` }}>
        <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
          Showing {sortedTemplates.length} of {templates.length} templates
        </Typography>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {viewMode === 'grid' ? (
            <Grid container spacing={3}>
              {sortedTemplates.map(template => (
                <Grid item xs={12} sm={6} md={4} key={template.id}>
                  {renderTemplateCard(template)}
                </Grid>
              ))}
            </Grid>
          ) : (
            <DataTable
              columns={tableColumns}
              shownCount={sortedTemplates.length}
              totalCount={templates.length}
            >
              {sortedTemplates.map(template => (
                <DataTableRow key={template.id} columns={tableColumns}>
                  <Box
                    onClick={() => handleColumnSort('name')}
                    sx={{ fontSize: 13, fontWeight: 600, color: (theme) => theme.palette.text.primary, cursor: 'pointer' }}
                  >
                    {template.name}{getSortIcon('name')}
                  </Box>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>
                    {template.category}
                    {template.subCategory && ` (${template.subCategory})`}
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.primary }}>
                    {template.subject}
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: (theme) => theme.palette.text.secondary }}>
                    {template.updatedAt
                      ? new Date(template.updatedAt).toLocaleDateString()
                      : 'N/A'}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    <StatusChip
                      kind={template.isActive ? 'success' : 'inactive'}
                      label={template.isActive ? 'Active' : 'Inactive'}
                    />
                    {template.isSystem && <StatusChip kind="warning" label="System" />}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                    <Box onClick={() => handleEditTemplate(template)} sx={actionLinkSx}>
                      Edit
                    </Box>
                    {!template.isSystem && (
                      <Box onClick={() => handleDeleteTemplate(template.id!)} sx={actionLinkSx}>
                        Delete
                      </Box>
                    )}
                    <Box
                      onClick={() => handleCloneTemplate(template.id!, `${template.name} (Copy)`)}
                      sx={actionLinkSx}
                    >
                      Clone
                    </Box>
                  </Box>
                </DataTableRow>
              ))}
            </DataTable>
          )}
        </>
      )}

      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={dialogTitleSx}>
          {selectedTemplate ? 'Edit Email Template' : 'Create Email Template'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} md={6}>
              <TextField
                label="Template Name"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select
                  value={formData.category}
                  onChange={e =>
                    setFormData({
                      ...formData,
                      category: e.target.value as EmailTemplate['category'],
                      subCategory: '',
                    })
                  }
                  label="Category"
                >
                  <MenuItem value="Instructor">Instructor</MenuItem>
                  <MenuItem value="Organization">Organization</MenuItem>
                  <MenuItem value="Course Admin">Course Admin</MenuItem>
                  <MenuItem value="Accountant">Accountant</MenuItem>
                  <MenuItem value="Sys Admin">Sys Admin</MenuItem>
                  <MenuItem value="Other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Sub-Category</InputLabel>
                <Select
                  value={formData.subCategory}
                  onChange={e => setFormData({ ...formData, subCategory: e.target.value })}
                  label="Sub-Category"
                  disabled={
                    !categoryOptions[formData.category] ||
                    categoryOptions[formData.category].length === 0
                  }
                >
                  {categoryOptions[formData.category]?.map(subCat => (
                    <MenuItem key={subCat} value={subCat}>
                      {subCat}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Description"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                fullWidth
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Subject Line"
                value={formData.subject}
                onChange={e => setFormData({ ...formData, subject: e.target.value })}
                fullWidth
                required
              />
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                multiple
                options={eventTriggers}
                getOptionLabel={option => option.label}
                value={eventTriggers.filter(et =>
                  formData.eventTriggers.includes(et.value)
                )}
                onChange={(_, newValue) => {
                  setFormData({
                    ...formData,
                    eventTriggers: newValue.map(v => v.value),
                  });
                }}
                renderInput={params => (
                  <TextField {...params} label="Event Triggers" />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                multiple
                options={commonVariables}
                getOptionLabel={option => `${option.name} - ${option.description}`}
                value={formData.availableVariables}
                onChange={(_, newValue) => {
                  setFormData({ ...formData, availableVariables: newValue });
                }}
                renderInput={params => (
                  <TextField {...params} label="Available Variables" />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <Box
                sx={{
                  mb: 2,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Typography sx={{ ...sectionHeaderSx, fontSize: 13 }}>
                  Email Content
                </Typography>
                <Box sx={{ display: 'flex', border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: '8px', overflow: 'hidden' }}>
                  {editorModes.map(mode => (
                    <Box
                      key={mode.value}
                      onClick={() => setEditorMode(mode.value)}
                      sx={{
                        px: 2,
                        py: 0.5,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        borderRadius: '6px',
                        bgcolor: editorMode === mode.value ? '#CC1F1F' : 'transparent',
                        color: editorMode === mode.value ? '#fff' : (theme) => theme.palette.text.secondary,
                        transition: 'background-color 0.15s, color 0.15s',
                      }}
                    >
                      {mode.label}
                    </Box>
                  ))}
                </Box>
              </Box>
              {editorMode === 'html' ? (
                <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: 1, height: 400 }}>
                  <React.Suspense fallback={<Box sx={{ p: 2 }}>Loading editor...</Box>}>
                    <Editor
                      height="400px"
                      defaultLanguage="html"
                      value={formData.htmlContent}
                      onChange={value =>
                        setFormData({ ...formData, htmlContent: value || '' })
                      }
                      options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        wordWrap: 'on',
                      }}
                    />
                  </React.Suspense>
                </Box>
              ) : editorMode === 'simple' ? (
                <TextField
                  value={formData.textContent || ''}
                  onChange={e => {
                    const text = e.target.value;
                    setFormData({
                      ...formData,
                      textContent: text,
                      htmlContent: convertToHtml(text),
                    });
                  }}
                  fullWidth
                  multiline
                  rows={15}
                  placeholder="Write your email in simple text format..."
                />
              ) : (
                <TextField
                  value={formData.htmlContent}
                  onChange={e =>
                    setFormData({ ...formData, htmlContent: e.target.value })
                  }
                  fullWidth
                  multiline
                  rows={15}
                  placeholder="Enter HTML content..."
                />
              )}
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.isActive}
                    onChange={e =>
                      setFormData({ ...formData, isActive: e.target.checked })
                    }
                  />
                }
                label="Active"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <GhostButton onClick={() => setEditDialogOpen(false)}>Cancel</GhostButton>
          <PrimaryButton onClick={handleSaveTemplate}>Save</PrimaryButton>
        </DialogActions>
      </Dialog>

      <Dialog
        open={previewDialogOpen}
        onClose={() => setPreviewDialogOpen(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle sx={dialogTitleSx}>
          Template Preview
          <Typography sx={{ fontSize: 12, color: (theme) => theme.palette.text.secondary, mt: 0.5 }}>
            Using sample data for preview
          </Typography>
        </DialogTitle>
        <DialogContent>
          {selectedTemplate && (
            <>
              <Box sx={{ mb: 3 }}>
                <Typography sx={{ ...sectionHeaderSx, mb: 1 }}>Variables:</Typography>
                <Grid container spacing={1}>
                  {selectedTemplate.availableVariables.map(variable => (
                    <Grid item xs={12} sm={6} key={variable.name}>
                      <TextField
                        size="small"
                        label={variable.name}
                        value={previewVariables[variable.name] || ''}
                        onChange={e =>
                          setPreviewVariables({
                            ...previewVariables,
                            [variable.name]: e.target.value,
                          })
                        }
                        fullWidth
                        helperText={variable.description}
                      />
                    </Grid>
                  ))}
                </Grid>
              </Box>
              <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, p: 2, borderRadius: 1 }}>
                <Typography sx={{ ...sectionHeaderSx, mb: 0.5 }}>Subject:</Typography>
                <Typography sx={{ mb: 2, fontSize: 14, color: (theme) => theme.palette.text.primary }}>
                  {selectedTemplate.subject.replace(
                    /\{\{(\w+)\}\}/g,
                    (_, key) => previewVariables[key] || `{{${key}}}`
                  )}
                </Typography>
                <Typography sx={{ ...sectionHeaderSx, mb: 0.5 }}>Body:</Typography>
                <Box
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(
                      (
                        selectedTemplate.htmlContent ||
                        selectedTemplate.body ||
                        ''
                      ).replace(
                        /\{\{(\w+)\}\}/g,
                        (_, key) => previewVariables[key] || `{{${key}}}`
                      )
                    ),
                  }}
                />
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <GhostButton onClick={() => setPreviewDialogOpen(false)}>Close</GhostButton>
          <PrimaryButton
            onClick={() => {
              setTestDialogOpen(true);
              setPreviewDialogOpen(false);
            }}
          >
            Send Test
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      <Dialog open={testDialogOpen} onClose={() => setTestDialogOpen(false)}>
        <DialogTitle sx={dialogTitleSx}>Send Test Email</DialogTitle>
        <DialogContent>
          <TextField
            label="Recipient Email"
            type="email"
            value={testEmail}
            onChange={e => setTestEmail(e.target.value)}
            fullWidth
            sx={{ mt: 2 }}
            helperText="Enter the email address to send the test to"
          />
        </DialogContent>
        <DialogActions>
          <GhostButton onClick={() => setTestDialogOpen(false)}>Cancel</GhostButton>
          <PrimaryButton onClick={handleTestEmail} disabled={!testEmail}>
            Send Test
          </PrimaryButton>
        </DialogActions>
      </Dialog>
      {confirmDialog}
    </Box>
  );
};

export default EmailTemplateManager;
