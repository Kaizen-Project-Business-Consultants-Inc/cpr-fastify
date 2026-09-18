import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
  AccountBalance as AccountBalanceIcon,
  Assignment as AssignmentIcon,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { timesheetService, TimesheetNote, TimesheetNoteSubmission } from '../../services/timesheetService';
import { useAuth } from '../../contexts/AuthContext';

interface TimesheetNotesProps {
  timesheetId: number;
  onNotesChange?: () => void;
}

const TimesheetNotes: React.FC<TimesheetNotesProps> = ({ timesheetId, onNotesChange }) => {
  const { user } = useAuth();
  const [notes, setNotes] = useState<TimesheetNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState('');
  const [noteType, setNoteType] = useState<'instructor' | 'hr' | 'accounting' | 'general'>('general');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<TimesheetNote | null>(null);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const notesData = await timesheetService.getTimesheetNotes(timesheetId);
      setNotes(notesData);
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { message?: string } }; message?: string };
      setError(errObj.response?.data?.message || errObj.message || 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [timesheetId]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;

    try {
      const noteData: TimesheetNoteSubmission = {
        noteText: newNote.trim(),
        noteType: noteType
      };

      await timesheetService.addTimesheetNote(timesheetId, noteData);
      setNewNote('');
      setNoteType('general');
      setAddDialogOpen(false);
      await loadNotes();
      if (onNotesChange) {
        onNotesChange();
      }
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { message?: string } }; message?: string };
      setError(errObj.response?.data?.message || errObj.message || 'Failed to add note');
    }
  };

  const handleDeleteNote = async () => {
    if (!noteToDelete) return;

    try {
      await timesheetService.deleteTimesheetNote(timesheetId, noteToDelete.id);
      setDeleteDialogOpen(false);
      setNoteToDelete(null);
      await loadNotes();
      if (onNotesChange) {
        onNotesChange();
      }
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { message?: string } }; message?: string };
      setError(errObj.response?.data?.message || errObj.message || 'Failed to delete note');
    }
  };

  const openDeleteDialog = (note: TimesheetNote) => {
    setNoteToDelete(note);
    setDeleteDialogOpen(true);
  };

  const getNoteTypeIcon = (type: string) => {
    switch (type) {
      case 'instructor':
        return <PersonIcon />;
      case 'hr':
        return <BusinessIcon />;
      case 'accounting':
        return <AccountBalanceIcon />;
      default:
        return <AssignmentIcon />;
    }
  };

  const getNoteTypeColor = (type: string) => {
    switch (type) {
      case 'instructor':
        return 'primary';
      case 'hr':
        return 'secondary';
      case 'accounting':
        return 'success';
      default:
        return 'default';
    }
  };

  const canDeleteNote = (note: TimesheetNote) => {
    return note.userId === user?.id || user?.role === 'hr';
  };

  const canAddNote = () => {
    return user?.role === 'instructor' || user?.role === 'hr' || user?.role === 'accountant';
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6" component="h3">
            Notes & Comments
          </Typography>
          {canAddNote() && (
            <Button
              startIcon={<AddIcon />}
              onClick={() => setAddDialogOpen(true)}
              variant="outlined"
              size="small"
            >
              Add Note
            </Button>
          )}
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Typography color="textSecondary">Loading notes...</Typography>
        ) : notes.length === 0 ? (
          <Typography color="textSecondary" sx={{ fontStyle: 'italic' }}>
            No notes yet. {canAddNote() && 'Add the first note using the button above.'}
          </Typography>
        ) : (
          <List>
            {notes.map((note, index) => (
              <React.Fragment key={note.id}>
                <ListItem alignItems="flex-start" sx={{ px: 0 }}>
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: `${getNoteTypeColor(note.noteType)}.main` }}>
                      {getNoteTypeIcon(note.noteType)}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Typography variant="subtitle2" component="span">
                          {note.addedBy}
                        </Typography>
                        <Chip
                          label={note.noteType}
                          size="small"
                          color={getNoteTypeColor(note.noteType) as 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'}
                          variant="outlined"
                        />
                        <Typography variant="caption" color="textSecondary">
                          {format(new Date(note.createdAt), 'MMM dd, yyyy HH:mm')}
                        </Typography>
                      </Box>
                    }
                    secondary={
                      <Typography
                        component="span"
                        variant="body2"
                        color="text.primary"
                        sx={{ whiteSpace: 'pre-wrap' }}
                      >
                        {note.noteText}
                      </Typography>
                    }
                  />
                  {canDeleteNote(note) && (
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => openDeleteDialog(note)}
                      sx={{ ml: 1 }}
                    >
                      <DeleteIcon />
                    </IconButton>
                  )}
                </ListItem>
                {index < notes.length - 1 && <Divider variant="inset" component="li" />}
              </React.Fragment>
            ))}
          </List>
        )}

        {/* Add Note Dialog */}
        <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Add Note</DialogTitle>
          <DialogContent>
            <FormControl fullWidth sx={{ mb: 2, mt: 1 }}>
              <InputLabel>Note Type</InputLabel>
              <Select
                value={noteType}
                onChange={(e) => setNoteType(e.target.value as 'instructor' | 'hr' | 'accounting' | 'general')}
                label="Note Type"
              >
                <MenuItem value="general">General</MenuItem>
                {user?.role === 'instructor' && (
                  <MenuItem value="instructor">Instructor Note</MenuItem>
                )}
                {user?.role === 'hr' && (
                  <MenuItem value="hr">HR Note</MenuItem>
                )}
                {user?.role === 'accountant' && (
                  <MenuItem value="accounting">Accounting Note</MenuItem>
                )}
              </Select>
            </FormControl>
            <TextField
              autoFocus
              multiline
              rows={4}
              fullWidth
              label="Note"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Enter your note here..."
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddNote} variant="contained" disabled={!newNote.trim()}>
              Add Note
            </Button>
          </DialogActions>
        </Dialog>

        {/* Delete Note Dialog */}
        <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
          <DialogTitle>Delete Note</DialogTitle>
          <DialogContent>
            <Typography>
              Are you sure you want to delete this note? This action cannot be undone.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleDeleteNote} color="error" variant="contained">
              Delete
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
};

export default TimesheetNotes; 